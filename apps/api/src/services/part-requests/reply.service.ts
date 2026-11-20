import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ReplyFitReason, SellerReplyView } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, partRequestReplies } from '../../db/schema.js';
import { AppError, ConflictError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { getSettings } from '../settings.service.js';
import { isEligibleSeller } from './eligibility.js';
import { emitRequestUpdated } from './emit.js';
import { lockOwnBusiness, lockPartRequest, partRequestNotFound } from './locks.js';
import { notifyReplyDelivered } from './reply-delivery.js';
import { replyFitReasons } from './reply-fit.js';
import { checkReplyCaps, ownPartRequest, requireOnboarded } from './reply-options.js';
import { sellerReplyViews } from './reply-views.js';

// Seller replies with existing listings (spec §9.2, R2; plan A2-4; ports textile `services/requirements/reply.service.ts`).
// Lock order (§9.5): the seller's own business (`FOR NO KEY UPDATE`: the caps are counted) → the request `FOR SHARE` →
// reply rows (their FK takes `KEY SHARE` on each listing). Replying never holds stock or opens a thread.

/** Why a listing in a send can't answer (`ReplyFitReason`, or `not_found` / `not_live` for someone else's or a non-live one). */
export type SendListingReason = ReplyFitReason | 'not_found' | 'not_live';

function notOpen(): ConflictError {
  return new ConflictError('This requirement is no longer open', 'PART_REQUEST_NOT_ACTIVE');
}

/**
 * `POST /part-requests/:id/replies { listingIds (1–3), message? }`: onboarding (`409 ONBOARDING_INCOMPLETE`); the
 * business, then the request `FOR SHARE`; the buyer's own → `409 OWN_PART_REQUEST`; not eligible → `404`; not `active` →
 * `409 PART_REQUEST_NOT_ACTIVE`. Each listing must be the seller's own, `live` and fitting (`replyFitReasons`): any
 * other reason → `400 REPLY_LISTING_INVALID { reasons: { [listingId]: reason } }`; only `replied` ones → `409
 * REPLY_EXISTS`. Caps (`409 REPLY_LIMIT`, `429 REPLY_DAILY_LIMIT`). Inserts `delivered` replies (message stored as
 * typed, masked on every read; `message_flagged` by the scam patterns), the buyer's grouped `part_request_reply` row
 * per reply and `part_request:updated`. Returns the new replies as the seller sees them.
 */
export async function sendReplies(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  body: { listingIds: string[]; message?: string | null },
): Promise<{ replies: SellerReplyView[] }> {
  const businessId = await requireOnboarded(tx, user.userId);
  await lockOwnBusiness(tx, businessId);
  const request = await lockPartRequest(tx, id, 'share');
  if (!request) throw partRequestNotFound();
  if (request.businessId === businessId) throw ownPartRequest();
  if (!(await isEligibleSeller(tx, id, businessId))) throw partRequestNotFound();
  if (request.status !== 'active') throw notOpen();

  const listingIds = [...new Set(body.listingIds)];
  const rows = await tx
    .select({ id: listings.id, businessId: listings.businessId, status: listings.status })
    .from(listings)
    .where(inArray(listings.id, listingIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fits = await replyFitReasons(tx, request, listingIds);
  const reasons: Record<string, SendListingReason> = {};
  for (const listingId of listingIds) {
    const row = byId.get(listingId);
    if (!row || row.businessId !== businessId) reasons[listingId] = 'not_found';
    else if (row.status !== 'live') reasons[listingId] = 'not_live';
    else {
      const fit = fits.get(listingId) ?? null;
      if (fit) reasons[listingId] = fit;
    }
  }
  const values = Object.values(reasons);
  if (values.some((r) => r !== 'replied')) {
    throw new ValidationError('Some listings can’t answer this requirement', { reasons }, 'REPLY_LISTING_INVALID');
  }
  if (values.length > 0) {
    throw new ConflictError('You already sent this listing', 'REPLY_EXISTS', { listingIds: Object.keys(reasons) });
  }

  await checkReplyCaps(tx, await getSettings(tx), id, businessId, listingIds.length);

  const message = body.message?.trim() ? body.message.trim() : null;
  const inserted = await tx
    .insert(partRequestReplies)
    .values(
      listingIds.map((listingId) => ({
        partRequestId: id,
        sellerBusinessId: businessId,
        listingId,
        createdByUserId: user.userId,
        message,
        messageFlagged: message ? looksLikeScam(message) : false,
        status: 'delivered' as const,
        deliveredAt: sql`now()` as unknown as Date,
      })),
    )
    .returning({ id: partRequestReplies.id, listingId: partRequestReplies.listingId });
  const order = new Map(listingIds.map((l, i) => [l, i]));
  inserted.sort((a, b) => order.get(a.listingId)! - order.get(b.listingId)!);
  for (const r of inserted) await notifyReplyDelivered(tx, request, r.id, businessId);

  const views = new Map((await sellerReplyViews(tx, id, businessId)).map((v) => [v.id, v]));
  return { replies: inserted.map((r) => views.get(r.id)!).filter(Boolean) };
}

/**
 * `POST /part-requests/:id/replies/:replyId/withdraw`: the replying business only (anyone else, or a reply on another
 * request → `404 REPLY_NOT_FOUND`); the request `FOR SHARE`, then a conditional `pending` / `delivered` → `withdrawn`
 * (else `409 REPLY_NOT_OPEN`). It leaves the buyer's view (`part_request:updated`).
 */
export async function withdrawReply(tx: Tx, user: UserTokenPayload, id: string, replyId: string): Promise<SellerReplyView> {
  const notFound = () => new AppError('Reply not found', 404, 'REPLY_NOT_FOUND');
  if (!user.businessId) throw notFound();
  const [reply] = await tx
    .select()
    .from(partRequestReplies)
    .where(and(eq(partRequestReplies.id, replyId), eq(partRequestReplies.partRequestId, id)));
  if (!reply || reply.sellerBusinessId !== user.businessId) throw notFound();
  const request = await lockPartRequest(tx, id, 'share');
  if (!request) throw notFound();
  const [done] = await tx
    .update(partRequestReplies)
    .set({ status: 'withdrawn', withdrawnAt: sql`now()` as unknown as Date })
    .where(and(eq(partRequestReplies.id, replyId), inArray(partRequestReplies.status, ['pending', 'delivered'])))
    .returning({ id: partRequestReplies.id });
  if (!done) throw new ConflictError('This reply is no longer open', 'REPLY_NOT_OPEN');
  emitRequestUpdated(tx, request, 'reply');
  const view = (await sellerReplyViews(tx, id, user.businessId)).find((v) => v.id === replyId);
  return view!;
}
