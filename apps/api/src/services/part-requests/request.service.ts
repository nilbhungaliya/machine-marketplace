import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  partRequestTransition,
  type PartRequestAction,
  type PartRequestBuyerView,
  type PartRequestCloseReason,
  type PartRequestPatch,
  type PartRequestStatus,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, deals, partRequestFitments, partRequestMatches, partRequestReplies, partRequests } from '../../db/schema.js';
import { ConflictError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { businessPointSql } from '../discovery/distance.js';
import { markRequestNotificationsRead } from '../notifications/request-rows.js';
import { getSettings } from '../settings.service.js';
import { buyerView } from './buyer-view.js';
import { writeRequestStatus } from './lifecycle.js';
import { lockOwnBusiness, lockPartRequest, partRequestNotFound, type PartRequestRow } from './locks.js';
import { dropPendingRepliesForRequest } from './reply-drops.js';
import {
  assertOnboarded,
  requestLimitState,
  resolveRequestFields,
  type ParsedPartRequestInput,
  type ResolvedFit,
  type ResolvedRequestFields,
} from './request-input.js';
import { resolveRequestPhotos } from './request-photos.js';
import { enqueuePartRequestWork } from './work-queue.js';

// The buyer's side of the lifecycle (spec §9.1, R3–R5; plan A1-1, A1-2; textile `services/requirements/requirement.service.ts`):
// post, edit, renew, close, fulfil and read. Status moves go through `writeRequestStatus` (the only status writer).
//
// Lock order (§9.5): the buyer business (`FOR NO KEY UPDATE`) only where a limit is counted (post, renew), then the
// request (`FOR NO KEY UPDATE`), then replies / matches / notifications. Storage I/O (photos) runs before the
// transaction; the route deletes the new finals when the transaction fails and the dropped ones after it commits.

type Conn = Db | Tx;
const asSql = <T>(s: ReturnType<typeof sql>) => s as unknown as T;

const notAllowed = (from: PartRequestStatus, action: PartRequestAction) =>
  new ConflictError('This requirement can’t do that now', 'PART_REQUEST_TRANSITION_NOT_ALLOWED', { from, action });

/** The request locked `FOR NO KEY UPDATE` when it is the user's business's; anyone else `404 PART_REQUEST_NOT_FOUND`. */
async function lockOwnRequest(tx: Tx, user: UserTokenPayload, id: string, businessId = user.businessId): Promise<PartRequestRow> {
  if (!businessId) throw partRequestNotFound();
  const row = await lockPartRequest(tx, id, 'no_key_update');
  if (!row || row.businessId !== businessId) throw partRequestNotFound();
  return row;
}

// ─── Limits (§12.1, plan D8) ───

/**
 * Open requests (`409 PART_REQUEST_OPEN_LIMIT { limit }`) and, for a post, posts this IST day (`429
 * PART_REQUEST_DAILY_LIMIT { limit }`). Run once unlocked before photo work and again under the business lock.
 */
async function assertLimits(conn: Conn, businessId: string, opts: { daily: boolean }): Promise<void> {
  const s = await requestLimitState(conn, businessId);
  if (s.openCount >= s.openLimit) {
    throw new ConflictError(`You can have ${s.openLimit} open requirements; close one first`, 'PART_REQUEST_OPEN_LIMIT', { limit: s.openLimit });
  }
  if (opts.daily && s.postsToday >= s.postsPerDay) {
    throw new TooManyRequestsError(`You can post ${s.postsPerDay} requirements a day`, 'PART_REQUEST_DAILY_LIMIT', { limit: s.postsPerDay });
  }
}

/** The business's location as a request snapshots it (§5.1): its pin, else its pincode's centroid; city, state, area. */
async function locationSnapshot(conn: Conn, businessId: string) {
  const [b] = await conn
    .select({
      pincode: businesses.pincode,
      city: businesses.city,
      state: businesses.state,
      industrialAreaId: businesses.industrialAreaId,
      industrialAreaOther: businesses.industrialAreaOther,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  return { ...b!, point: asSql<string>(sql`${businessPointSql(businessId)}`) };
}

async function writeFits(tx: Tx, requestId: string, fits: ResolvedFit[]): Promise<void> {
  await tx.delete(partRequestFitments).where(eq(partRequestFitments.partRequestId, requestId));
  if (fits.length) {
    await tx.insert(partRequestFitments).values(fits.map((f, i) => ({ partRequestId: requestId, ...f, sortOrder: i })));
  }
}

// ─── Post (A1-1) ───

export interface PreparedPost {
  id: string;
  businessId: string;
  resolved: ResolvedRequestFields;
  /** Final private keys (already in storage). */
  photoKeys: string[];
}

/**
 * Everything a post does before its transaction: onboarding (`409 ONBOARDING_INCOMPLETE`), the fields
 * (`resolveRequestFields`), an **unlocked** limit pre-check (so a refused post never copies photos), the request's uuid,
 * then the photos finalised into `part-request/<id>/…`. The idempotent replay is the plugin's fast path, before this.
 */
export async function preparePartRequest(db: Db, user: UserTokenPayload, input: ParsedPartRequestInput): Promise<PreparedPost> {
  const businessId = await assertOnboarded(db, user);
  const resolved = await resolveRequestFields(db, input, null);
  await assertLimits(db, businessId, { daily: true });
  const id = randomUUID();
  const photoKeys = input.photoKeys?.length ? (await resolveRequestPhotos(businessId, id, input.photoKeys, [])).keys : [];
  return { id, businessId, resolved, photoKeys };
}

/**
 * The post's transaction: the business locked, the limits again, the row (location snapshot, `expires_at = now() +
 * days`), fits and one `target_request` work row. Returns the buyer view.
 */
export async function insertPartRequest(tx: Tx, user: UserTokenPayload, p: PreparedPost): Promise<PartRequestBuyerView> {
  await lockOwnBusiness(tx, p.businessId);
  await assertLimits(tx, p.businessId, { daily: true });
  const location = await locationSnapshot(tx, p.businessId);
  const [row] = await tx
    .insert(partRequests)
    .values({
      id: p.id,
      businessId: p.businessId,
      createdByUserId: user.userId,
      kind: p.resolved.kind,
      ...p.resolved.values,
      ...location,
      photoKeys: p.photoKeys,
      validityDays: p.resolved.validityDays!,
      expiresAt: asSql<Date>(sql`now() + make_interval(days => ${p.resolved.validityDays!}::int)`),
    })
    .returning();
  await writeFits(tx, row!.id, p.resolved.fits ?? []);
  await enqueuePartRequestWork(tx, 'target_request', row!.id);
  return buyerView(tx, row!);
}

// ─── Edit (A1-2) ───

export interface PreparedEdit {
  /** Present when the PATCH sent `photoKeys`: the final list and the new finals (deleted if the write fails). */
  photos?: { keys: string[]; added: string[] };
}

/**
 * Before the edit's transaction: the request must be the user's business's (404), and when `photoKeys` is sent, the
 * fields are checked (so a refused edit never copies photos) and the new uploads finalised.
 */
export async function prepareEdit(db: Db, user: UserTokenPayload, id: string, patch: PartRequestPatch): Promise<PreparedEdit> {
  if (patch.photoKeys === undefined) return {};
  if (!user.businessId) throw partRequestNotFound();
  const [row] = await db.select().from(partRequests).where(eq(partRequests.id, id));
  if (!row || row.businessId !== user.businessId) throw partRequestNotFound();
  if (row.status !== 'active') throw notAllowed(row.status, 'edit');
  if (row.version !== patch.version) throw stale();
  await resolveRequestFields(db, patch, row);
  const photos = await resolveRequestPhotos(row.businessId, row.id, patch.photoKeys, row.photoKeys);
  return { photos: { keys: photos.keys, added: photos.added } };
}

const stale = () => new ConflictError('This requirement was changed meanwhile; reload it', 'PART_REQUEST_STALE');

/**
 * `PATCH /part-requests/:id`: `active` only (`409 PART_REQUEST_TRANSITION_NOT_ALLOWED`), `version` must match (`409
 * PART_REQUEST_STALE`); `version + 1`, the location snapshot refreshed; `photoKeys` is the full final list (stored keys
 * kept, uploads finalised before, stored keys left out returned in `droppedPhotos` for deletion after commit); a
 * matching-field change queues `target_request`. Delivered replies and matches are untouched (review Q5).
 */
export async function editPartRequest(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  patch: PartRequestPatch,
  prepared: PreparedEdit,
): Promise<{ view: PartRequestBuyerView; droppedPhotos: string[] }> {
  const row = await lockOwnRequest(tx, user, id);
  if (partRequestTransition(row.status, 'edit') === null) throw notAllowed(row.status, 'edit');
  if (row.version !== patch.version) throw stale();
  const resolved = await resolveRequestFields(tx, patch, row);

  let droppedPhotos: string[] = [];
  let photoKeys: string[] | undefined;
  if (prepared.photos) {
    const allowed = new Set([...row.photoKeys, ...prepared.photos.added]);
    if (prepared.photos.keys.some((k) => !allowed.has(k))) throw stale();
    photoKeys = prepared.photos.keys;
    droppedPhotos = row.photoKeys.filter((k) => !photoKeys!.includes(k));
  }

  const updated = await writeRequestStatus(tx, row, 'edit', {
    ...resolved.values,
    ...(await locationSnapshot(tx, row.businessId)),
    ...(photoKeys ? { photoKeys } : {}),
    version: row.version + 1,
  });
  if (resolved.fits !== undefined) await writeFits(tx, row.id, resolved.fits);
  if (resolved.matchingChanged) await enqueuePartRequestWork(tx, 'target_request', row.id);
  return { view: await buyerView(tx, updated), droppedPhotos };
}

// ─── Renew, close, fulfil (A1-2) ───

/**
 * `POST /part-requests/:id/renew { days }`: the business locked first, then the request; `days` one of the validity
 * settings (`400 VALIDITY_INVALID`, plan D9); from `active` or `expired`; from `expired` the open limit applies and
 * `target_request` is queued; `expires_at = max(now, expires_at) + days` must stay within `first_posted_at +
 * part_request_max_days` (`409 PART_REQUEST_MAX_DAYS`); the expiring reminder is re-armed.
 */
export async function renewPartRequest(tx: Tx, user: UserTokenPayload, id: string, body: { days: number }): Promise<PartRequestBuyerView> {
  const businessId = await assertOnboarded(tx, user);
  await lockOwnBusiness(tx, businessId);
  const row = await lockOwnRequest(tx, user, id, businessId);
  const s = await getSettings(tx);
  const allowed = [s.part_request_validity_days_1, s.part_request_validity_days_2, s.part_request_validity_days_3];
  if (!allowed.includes(body.days)) throw new ValidationError('Pick one of the offered periods', { allowed }, 'VALIDITY_INVALID');
  if (partRequestTransition(row.status, 'renew') === null) throw notAllowed(row.status, 'renew');
  const fromExpired = row.status === 'expired';
  if (fromExpired) await assertLimits(tx, businessId, { daily: false });

  const newExpiry = sql`GREATEST(now(), ${partRequests.expiresAt}) + make_interval(days => ${body.days}::int)`;
  const [fits] = await tx
    .select({ ok: sql<boolean>`${newExpiry} <= ${partRequests.firstPostedAt} + make_interval(days => ${s.part_request_max_days}::int)` })
    .from(partRequests)
    .where(eq(partRequests.id, row.id));
  if (!fits?.ok) {
    throw new ConflictError(`A requirement stays open at most ${s.part_request_max_days} days from its first post`, 'PART_REQUEST_MAX_DAYS', {
      maxDays: s.part_request_max_days,
    });
  }
  const updated = await writeRequestStatus(tx, row, 'renew', {
    expiresAt: asSql<Date>(newExpiry),
    validityDays: body.days,
    expiringNotifiedAt: null,
  });
  if (fromExpired) await enqueuePartRequestWork(tx, 'target_request', row.id);
  return buyerView(tx, updated);
}

/** `POST /part-requests/:id/close { reason }`: `active` → `closed`; pending replies dropped (`request_closed`). */
export async function closePartRequest(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  body: { reason: PartRequestCloseReason },
): Promise<PartRequestBuyerView> {
  const row = await lockOwnRequest(tx, user, id);
  const updated = await writeRequestStatus(tx, row, 'close', { closeReason: body.reason });
  await dropPendingRepliesForRequest(tx, updated, 'request_closed');
  return buyerView(tx, updated);
}

/**
 * `POST /part-requests/:id/fulfil { dealId? }`: `active` → `fulfilled`; `dealId` must be a deal whose buyer is this
 * business (`400 DEAL_INVALID`); pending replies dropped (`request_closed`).
 */
export async function fulfilPartRequest(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  body: { dealId?: string },
): Promise<PartRequestBuyerView> {
  const row = await lockOwnRequest(tx, user, id);
  if (partRequestTransition(row.status, 'fulfil') === null) throw notAllowed(row.status, 'fulfil');
  if (body.dealId) {
    const [d] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, body.dealId), eq(deals.buyerBusinessId, row.businessId)));
    if (!d) throw new ValidationError('That deal isn’t one of your purchases', { field: 'dealId' }, 'DEAL_INVALID');
  }
  const updated = await writeRequestStatus(tx, row, 'fulfil', { fulfilledDealId: body.dealId ?? null });
  await dropPendingRepliesForRequest(tx, updated, 'request_closed');
  return buyerView(tx, updated);
}

// ─── Read (A1-2, plan D7) ───

/**
 * `POST /part-requests/:id/read`: a member of the buyer business (viewers too) opened the request. The request is
 * locked first (review change 2), then the reading user's two grouped rows are marked read, delivered replies get
 * `buyer_viewed_at`, matches `seen_at`, and the request `buyer_seen_at`. Anyone else 404.
 */
export async function markPartRequestRead(tx: Tx, user: UserTokenPayload, id: string): Promise<{ ok: true }> {
  const row = await lockOwnRequest(tx, user, id);
  await markRequestNotificationsRead(tx, user.userId, row.id);
  await tx
    .update(partRequestReplies)
    .set({ buyerViewedAt: asSql<Date>(sql`now()`) })
    .where(and(eq(partRequestReplies.partRequestId, row.id), eq(partRequestReplies.status, 'delivered'), isNull(partRequestReplies.buyerViewedAt)));
  await tx
    .update(partRequestMatches)
    .set({ seenAt: asSql<Date>(sql`now()`) })
    .where(and(eq(partRequestMatches.partRequestId, row.id), isNull(partRequestMatches.seenAt)));
  await tx.update(partRequests).set({ buyerSeenAt: asSql<Date>(sql`now()`) }).where(eq(partRequests.id, row.id));
  return { ok: true };
}
