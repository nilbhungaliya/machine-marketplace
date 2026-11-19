import { inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { db } from '../../src/db/index.js';
import { pincodeOffices, savedListings, searchQueries, searchRefreshJobs, searchSynonyms, searchTrendingHidden } from '../../src/db/schema.js';
import { discoveryRedisPrefix } from '../../src/env.js';

// F4 + F5 discovery fixtures (plan B0-2). Synonym, search-log and trending-hidden rows of a suite carry its run id: terms
// are `zzt-<runId>-…`, so their normalised form starts `zzt <runId>`. Pincode rows for this feature use 990021–990029.
// Cleanup in afterAll: deleteTestDiscovery (before the admins, users and listings it names) → deleteTestBusinesses
// (saved rows go with the listings and users) → deleteTestPincodeOffices → deleteTestRedisKeys.

let seq = 0;

/** A lowercase alphanumeric id unique per call, for a suite's terms. */
export function testRunId(): string {
  return `${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`;
}

/** A synonym term / query text of the run: `zzt-<runId>-<s>` (normalised: `zzt <runId> <s>`). */
export function testTerm(runId: string, s: string): string {
  return `zzt-${runId}-${s}`;
}

/** The normalised prefix of the run's terms. */
export function testTermNorm(runId: string): string {
  return `zzt ${runId}`;
}

/**
 * Deletes the run's discovery rows: synonyms (by term, or created / updated by `adminIds`), search-log and
 * trending-hidden rows (by normalised text, or hidden by `adminIds`), saved rows of `userIds` / `listingIds`, refresh
 * jobs of `scopeIds` or created by `adminIds`.
 */
export async function deleteTestDiscovery(
  runId: string,
  opts: { userIds?: string[]; listingIds?: string[]; adminIds?: string[]; scopeIds?: string[] } = {},
): Promise<void> {
  if (!/^[a-z0-9]+$/.test(runId)) throw new Error(`deleteTestDiscovery: bad run id "${runId}"`);
  // The trailing separator keeps run "abc" from matching run "abcd".
  const term = `zzt-${runId}-%`;
  const norm = `${testTermNorm(runId)} %`;
  const admins = opts.adminIds ?? [];
  const any = (conds: Array<SQL | undefined>): SQL | undefined => or(...conds.filter((c): c is SQL => c !== undefined));

  await db.delete(searchSynonyms).where(
    any([
      like(searchSynonyms.term, term),
      like(searchSynonyms.termNorm, norm),
      admins.length ? inArray(searchSynonyms.createdBy, admins) : undefined,
      admins.length ? inArray(searchSynonyms.updatedBy, admins) : undefined,
    ]),
  );
  await db.delete(searchQueries).where(like(searchQueries.normalized, norm));
  await db
    .delete(searchTrendingHidden)
    .where(any([like(searchTrendingHidden.normalized, norm), admins.length ? inArray(searchTrendingHidden.createdBy, admins) : undefined]));
  const saved = any([
    opts.userIds?.length ? inArray(savedListings.userId, opts.userIds) : undefined,
    opts.listingIds?.length ? inArray(savedListings.listingId, opts.listingIds) : undefined,
  ]);
  if (saved) await db.delete(savedListings).where(saved);
  const jobs = any([
    opts.scopeIds?.length ? inArray(searchRefreshJobs.scopeId, opts.scopeIds) : undefined,
    admins.length ? inArray(searchRefreshJobs.createdBy, admins) : undefined,
  ]);
  if (jobs) await db.delete(searchRefreshJobs).where(jobs);
}

const DISCOVERY_PINCODE = /^99002[1-9]$/;

/** `pincode_offices` rows for a discovery test pincode (990021–990029) at these points. Returns their ids. */
export async function insertTestPincodeOffices(
  pincode: string,
  points: Array<{ lat: number; lng: number; officeName?: string; district?: string }>,
): Promise<string[]> {
  if (!DISCOVERY_PINCODE.test(pincode)) throw new Error(`insertTestPincodeOffices: only 990021-990029 (got ${pincode})`);
  if (points.length === 0) return [];
  const rows = await db
    .insert(pincodeOffices)
    .values(
      points.map((p, i) => ({
        pincode,
        officeName: p.officeName ?? `Test Discovery PO ${i + 1}`,
        district: p.district ?? 'Surat',
        state: 'Gujarat',
        point: sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`,
      })),
    )
    .returning({ id: pincodeOffices.id });
  return rows.map((r) => r.id);
}

export async function deleteTestPincodeOffices(ids: string[]): Promise<void> {
  if (ids.length) await db.delete(pincodeOffices).where(inArray(pincodeOffices.id, ids));
}

/** Deletes every Redis key under this worker's discovery prefix (refuses anything but a `test:` prefix). */
export async function deleteTestRedisKeys(redis: Redis): Promise<void> {
  const prefix = discoveryRedisPrefix();
  if (!prefix.startsWith('test:')) throw new Error(`deleteTestRedisKeys: not a test prefix ("${prefix}")`);
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
}
