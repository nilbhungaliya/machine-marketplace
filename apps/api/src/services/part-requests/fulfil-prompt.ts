import { and, asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { businesses, partRequests } from '../../db/schema.js';
import { notify } from '../notifications/notify.js';
import { maskedRequestName } from './reply-views.js';

// F6 accept → "Deal agreed with … Mark … fulfilled?" (spec §9.4, `part_request_fulfil_prompt`). Called by `acceptOffer`
// in its transaction, after the deal row. Lane A3 owns this file.

/**
 * Prompts the buyer for each of its `active` requests the deal's listing answers (a `delivered` reply or an auto match):
 * `part_request_fulfil_prompt` to the **buyer business** — always, even when a buyer member accepted (review Q2, plan
 * D5) — dedupe `part_request_fulfil_prompt:<requestId>:<dealId>`, params `{ businessName (the seller), requestTitle
 * (masked) }`, destination `{ partRequestId, dealId }`.
 *
 * **Read-only on F8 rows and no F8 lock** (§9.4, §9.5): a plain read, then the notification insert, whose
 * `part_request_id` FK takes `KEY SHARE` on the request — compatible with the `FOR NO KEY UPDATE` a job or a buyer write
 * may hold, so accept never waits on F8. A request that leaves `active` meanwhile still gets its prompt; the banner
 * reads the status on open.
 */
export async function notifyFulfilPrompts(
  tx: Tx,
  d: { dealId: string; listingId: string; buyerBusinessId: string; sellerBusinessId: string },
): Promise<void> {
  // Raw correlated subqueries: Drizzle renders columns unqualified in a single-table select (C0 note 8).
  const answered = sql`(EXISTS (SELECT 1 FROM part_request_replies rr
                                  WHERE rr.part_request_id = part_requests.id AND rr.listing_id = ${d.listingId}
                                    AND rr.status = 'delivered')
                     OR EXISTS (SELECT 1 FROM part_request_matches m
                                  WHERE m.part_request_id = part_requests.id AND m.listing_id = ${d.listingId}))`;
  const requests = await tx
    .select({ id: partRequests.id, name: partRequests.name })
    .from(partRequests)
    .where(and(eq(partRequests.businessId, d.buyerBusinessId), eq(partRequests.status, 'active'), answered))
    .orderBy(asc(partRequests.id));
  if (requests.length === 0) return;

  const [seller] = await tx
    .select({ name: businesses.tradeName })
    .from(businesses)
    .where(eq(businesses.id, d.sellerBusinessId));
  for (const r of requests) {
    await notify(tx, {
      type: 'part_request_fulfil_prompt',
      recipientBusinessId: d.buyerBusinessId,
      params: { businessName: seller?.name ?? '', requestTitle: maskedRequestName(r.name) },
      destination: { partRequestId: r.id, dealId: d.dealId },
      dedupeKey: `part_request_fulfil_prompt:${r.id}:${d.dealId}`,
    });
  }
}
