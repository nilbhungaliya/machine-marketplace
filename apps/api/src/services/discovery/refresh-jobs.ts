import { and, asc, eq, gt, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DISCOVERY_LIMITS, type SearchRefreshScope } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, listings, searchRefreshJobs, templateFields } from '../../db/schema.js';
import { bumpReaderVersion } from './reader-version.js';
import { refreshListingSearch } from './search-text.js';

// Catalogue changes and search (F4 + F5 spec §5.2, §5.3; plan B1-2). Two separate rules:
// - every catalogue mutation of categories, brands, models, conditions and template options bumps the reader version
//   after it commits (`afterCatalogCommit`), so every API instance's query reader sees the change within 5 s;
// - only a change that can alter listings' search text (rename, move, delete, option-label or condition-label change)
//   also queues a `search_refresh_jobs` row in its own transaction (`queueSearchRefresh`). The admin transaction never
//   locks a listing: the `search-refresh` job rebuilds the affected listings in short batches.

type Conn = Db | Tx;

/** Call after a catalogue write commits (never inside the transaction). A Redis failure never fails the write. */
export async function afterCatalogCommit(redis: Redis | null | undefined): Promise<void> {
  try {
    await bumpReaderVersion(redis);
  } catch {
    // The write committed; the reader picks the change up at the next bump.
  }
}

/** Queues a background rebuild of the listings a catalogue change touches, in the admin's transaction. */
export async function queueSearchRefresh(tx: Tx, scopeKind: SearchRefreshScope, scopeId: string, adminId: string | null): Promise<void> {
  await tx.insert(searchRefreshJobs).values({ scopeKind, scopeId, createdBy: adminId });
}

/**
 * The listings a job's scope reaches, in id order after `afterId`: a category and its descendants (by path), a brand
 * (part brand, fitment brand, machine make), a model (fitment or machine model), a field (listings under the field's
 * node) or a condition. A scope that no longer exists reaches nothing.
 */
export async function scopeListingIds(
  conn: Conn,
  scopeKind: SearchRefreshScope,
  scopeId: string,
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  let where: SQL;
  switch (scopeKind) {
    case 'category':
    case 'field': {
      const nodeId =
        scopeKind === 'category'
          ? scopeId
          : ((await conn.select({ id: templateFields.categoryId }).from(templateFields).where(eq(templateFields.id, scopeId)))[0]?.id ?? null);
      const [node] = nodeId ? await conn.select({ path: categories.path }).from(categories).where(eq(categories.id, nodeId)) : [];
      if (!node) return [];
      where = sql`${listings.categoryId} IN (SELECT c.id FROM categories c WHERE c.path = ${node.path} OR c.path LIKE ${`${node.path}/%`})`;
      break;
    }
    case 'brand':
      where = sql`(${listings.partBrandId} = ${scopeId}
        OR EXISTS (SELECT 1 FROM listing_fitments f WHERE f.listing_id = ${listings.id} AND f.brand_id = ${scopeId})
        OR EXISTS (SELECT 1 FROM listing_machines m WHERE m.listing_id = ${listings.id} AND m.brand_id = ${scopeId}))`;
      break;
    case 'model':
      where = sql`(EXISTS (SELECT 1 FROM listing_fitments f WHERE f.listing_id = ${listings.id} AND f.model_id = ${scopeId})
        OR EXISTS (SELECT 1 FROM listing_machines m WHERE m.listing_id = ${listings.id} AND m.model_id = ${scopeId}))`;
      break;
    case 'condition':
      where = eq(listings.conditionId, scopeId);
      break;
  }
  const rows = await conn
    .select({ id: listings.id })
    .from(listings)
    .where(afterId ? and(where, gt(listings.id, afterId)) : where)
    .orderBy(asc(listings.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Rebuilds one batch in its own short transaction, locking its listings `FOR UPDATE` in id order. */
async function refreshBatch(db: Db, ids: string[], refresh: (tx: Tx, ids: string[]) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await tx.select({ id: listings.id }).from(listings).where(inArray(listings.id, ids)).orderBy(asc(listings.id)).for('update');
    await refresh(
      tx,
      locked.map((r) => r.id),
    );
  });
}

export interface SearchRefreshOptions {
  /** Test hook: replaces `refreshListingSearch` (to make a batch fail). */
  refresh?: (tx: Tx, ids: string[]) => Promise<void>;
  batchSize?: number;
}

export interface SearchRefreshRun {
  jobId: string | null;
  listings: number;
  error: string | null;
}

/**
 * The `search-refresh` job (§5.2): claims the pending job (`done_at` null, fewer than 5 attempts) with the fewest
 * attempts, oldest first, with
 * `FOR UPDATE SKIP LOCKED` and keeps that row locked while it rebuilds the scope's listings in batches of 200, each
 * batch its own transaction on another connection. Success marks the job done; a failure records `last_error` and the
 * attempt, and the job is tried again on a later tick (at most 5 attempts in all).
 */
export async function runSearchRefresh(db: Db, opts: SearchRefreshOptions = {}): Promise<SearchRefreshRun> {
  const refresh = opts.refresh ?? refreshListingSearch;
  const batchSize = opts.batchSize ?? DISCOVERY_LIMITS.refreshBatchSize;
  return db.transaction(async (claim) => {
    const [job] = await claim
      .select()
      .from(searchRefreshJobs)
      .where(and(isNull(searchRefreshJobs.doneAt), lt(searchRefreshJobs.attempts, DISCOVERY_LIMITS.refreshMaxAttempts)))
      // Fewest attempts first: a job that keeps failing never blocks newer ones.
      .orderBy(asc(searchRefreshJobs.attempts), asc(searchRefreshJobs.createdAt), asc(searchRefreshJobs.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!job) return { jobId: null, listings: 0, error: null };

    let done = 0;
    let error: string | null = null;
    try {
      let after: string | null = null;
      for (;;) {
        const ids = await scopeListingIds(db, job.scopeKind, job.scopeId, after, batchSize);
        if (ids.length === 0) break;
        await refreshBatch(db, ids, refresh);
        done += ids.length;
        after = ids[ids.length - 1]!;
        if (ids.length < batchSize) break;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await claim
      .update(searchRefreshJobs)
      .set({
        attempts: sql`${searchRefreshJobs.attempts} + 1`,
        startedAt: job.startedAt ?? sql`now()`,
        ...(error === null ? { doneAt: sql`now()`, lastError: null } : { lastError: error.slice(0, 1000) }),
      })
      .where(eq(searchRefreshJobs.id, job.id));
    return { jobId: job.id, listings: done, error };
  });
}

/**
 * `pnpm --filter @mpm/api db:backfill:search`: rebuilds every listing's search columns in batches of 200 in id order,
 * each batch its own transaction. Idempotent.
 */
export async function backfillSearch(db: Db, opts: { batchSize?: number; log?: (n: number) => void } = {}): Promise<number> {
  const batchSize = opts.batchSize ?? DISCOVERY_LIMITS.refreshBatchSize;
  let after: string | null = null;
  let total = 0;
  for (;;) {
    const rows: Array<{ id: string }> = await db
      .select({ id: listings.id })
      .from(listings)
      .where(after ? gt(listings.id, after) : undefined)
      .orderBy(asc(listings.id))
      .limit(batchSize);
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    await refreshBatch(db, ids, refreshListingSearch);
    total += ids.length;
    opts.log?.(total);
    after = ids[ids.length - 1]!;
    if (rows.length < batchSize) break;
  }
  return total;
}

/**
 * One tick of the `search-refresh` job: runs pending jobs one after another (at most `maxJobs`) and stops at the first
 * failure, so a failing job is retried on a later tick instead of using up its attempts at once.
 */
export async function runSearchRefreshTick(
  db: Db,
  opts: SearchRefreshOptions & { maxJobs?: number; onError?: (run: SearchRefreshRun) => void } = {},
): Promise<number> {
  const max = opts.maxJobs ?? 10;
  let ran = 0;
  for (; ran < max; ) {
    const result = await runSearchRefresh(db, opts);
    if (!result.jobId) break;
    ran++;
    if (result.error) {
      opts.onError?.(result);
      break;
    }
  }
  return ran;
}
