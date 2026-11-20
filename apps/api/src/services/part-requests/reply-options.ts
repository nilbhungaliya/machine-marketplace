import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppSettingsValues, ReplyOption, ReplyOptionsResponse } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings, partRequestReplies, partRequests, users } from '../../db/schema.js';
import { ConflictError, TooManyRequestsError } from '../../lib/errors.js';
import { IST_MIDNIGHT } from '../../lib/ist.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { onboardingForUser } from '../business/profile.service.js';
import { loadCards } from '../listings/listing-view.service.js';
import { getSettings } from '../settings.service.js';
import { requestRoleFor } from './eligibility.js';
import { partRequestNotFound } from './locks.js';
import { replyFitReasons } from './reply-fit.js';

// The reply picker and the reply caps (spec §9.2, plan D8; textile app `reply-with-lot.tsx` options). The caps are
// shared by the send, the picker and create-listing-with-request; writers count them under the seller business's
// `FOR NO KEY UPDATE` lock, so two sends can't both pass.

type Conn = Db | Tx;

/** The picker lists at most this many of the seller's live listings (fitting first). */
export const REPLY_OPTIONS_MAX = 100;

/** `409 OWN_PART_REQUEST`: the buyer business can't answer its own requirement. */
export function ownPartRequest(): ConflictError {
  return new ConflictError('This is your own requirement', 'OWN_PART_REQUEST');
}

/** `409 ONBOARDING_INCOMPLETE` unless the user's business finished onboarding (§6: `requireUser` doesn't check it). */
export async function requireOnboarded(conn: Conn, userId: string): Promise<string> {
  const [u] = await conn.select({ name: users.name, businessId: users.businessId }).from(users).where(eq(users.id, userId));
  if (!u?.businessId || (await onboardingForUser(conn, u)) !== 'done') {
    throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  }
  return u.businessId;
}

/** The seller's `pending` + `delivered` replies on the request (the per-request cap). */
export async function openReplyCount(conn: Conn, partRequestId: string, sellerBusinessId: string): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(partRequestReplies)
    .where(
      and(
        eq(partRequestReplies.partRequestId, partRequestId),
        eq(partRequestReplies.sellerBusinessId, sellerBusinessId),
        inArray(partRequestReplies.status, ['pending', 'delivered']),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Reply rows the seller business created since IST midnight, any status (the daily cap, D8). */
export async function repliesToday(conn: Conn, sellerBusinessId: string): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(partRequestReplies)
    .where(and(eq(partRequestReplies.sellerBusinessId, sellerBusinessId), sql`${partRequestReplies.createdAt} >= ${IST_MIDNIGHT}`));
  return Number(row?.n ?? 0);
}

/** `{ slotsLeft, dailyLeft }`: per-request slots (`part_request_reply_listings_max`) and today's replies left. */
export async function replyAllowance(
  conn: Conn,
  settings: AppSettingsValues,
  partRequestId: string,
  sellerBusinessId: string,
): Promise<{ slotsLeft: number; dailyLeft: number }> {
  const open = await openReplyCount(conn, partRequestId, sellerBusinessId);
  const today = await repliesToday(conn, sellerBusinessId);
  return {
    slotsLeft: Math.max(0, settings.part_request_reply_listings_max - open),
    dailyLeft: Math.max(0, settings.part_request_replies_per_day - today),
  };
}

/** `adding` more replies fit both caps, else `409 REPLY_LIMIT` (per request) / `429 REPLY_DAILY_LIMIT` (per IST day). */
export async function checkReplyCaps(
  conn: Conn,
  settings: AppSettingsValues,
  partRequestId: string,
  sellerBusinessId: string,
  adding: number,
): Promise<void> {
  const { slotsLeft, dailyLeft } = await replyAllowance(conn, settings, partRequestId, sellerBusinessId);
  if (adding > slotsLeft) {
    throw new ConflictError(
      `You can send ${settings.part_request_reply_listings_max} listings to one requirement`,
      'REPLY_LIMIT',
      { slotsLeft },
    );
  }
  if (adding > dailyLeft) {
    throw new TooManyRequestsError('You have sent today’s replies; try again tomorrow', 'REPLY_DAILY_LIMIT', { dailyLeft });
  }
}

/**
 * `GET /part-requests/:id/reply-options` (§9.2): the seller's live listings of the request's kind, fitting ones first
 * (then the newest), each with `fit` and, when it can't answer, its reason (`kind`, `category`, `side`, `condition`,
 * `replied`), plus the caps left. The buyer's own request → `409 OWN_PART_REQUEST`; not eligible → `404`.
 */
export async function replyOptions(conn: Conn, user: UserTokenPayload, id: string): Promise<ReplyOptionsResponse> {
  const businessId = user.businessId;
  if (!businessId) throw partRequestNotFound();
  const role = await requestRoleFor(conn, id, businessId);
  if (role === 'buyer') throw ownPartRequest();
  if (role !== 'seller') throw partRequestNotFound();
  const [request] = await conn.select().from(partRequests).where(eq(partRequests.id, id));
  if (!request) throw partRequestNotFound();

  const rows = await conn
    .select()
    .from(listings)
    .where(and(eq(listings.businessId, businessId), eq(listings.status, 'live'), eq(listings.kind, request.kind)))
    .orderBy(desc(listings.refreshedAt), desc(listings.id));
  const reasons = await replyFitReasons(conn, request, rows.map((r) => r.id));
  const ordered = rows
    .map((row, i) => ({ row, i, reason: reasons.get(row.id) ?? null }))
    .sort((a, b) => Number(a.reason !== null) - Number(b.reason !== null) || a.i - b.i)
    .slice(0, REPLY_OPTIONS_MAX);
  const cards = await loadCards(conn, ordered.map((o) => o.row), { viewerBusinessId: businessId, viewerUserId: user.userId });
  const options: ReplyOption[] = ordered.map((o, i) => ({
    listingId: o.row.id,
    card: cards[i]!,
    fit: o.reason === null,
    reason: o.reason,
  }));
  const settings = await getSettings(conn);
  return { listings: options, ...(await replyAllowance(conn, settings, id, businessId)) };
}
