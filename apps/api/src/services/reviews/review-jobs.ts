import { and, eq, isNull, sql } from 'drizzle-orm';
import { dealReviews, deals } from '../../db/schema.js';
import { effectsTx, runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { notifyPublished } from './review.service.js';
import type { ReviewRow } from './review-state.js';

/**
 * Review jobs (F6 + F7 spec §10.3, §14). L4-1 owns this file. Run from `jobs/index.ts`.
 */

const BATCH = 100;

/**
 * `review-publish` (15 min): a single review past its `publish_due_at` publishes alone, after which the other side can
 * no longer review. Each batch claims due rows `FOR UPDATE SKIP LOCKED` (a submit holding a deal's reviews publishes
 * both itself), and each row publishes in its own savepoint with `published_at IS NULL` re-checked, so running twice or
 * concurrently publishes (and notifies) once. Returns how many published.
 */
export async function publishDueReviews(app: TxApp): Promise<number> {
  let published = 0;
  for (;;) {
    const before = published;
    const claimed = await runJobTx(app, async (tx) => {
      const { rows } = await tx.execute(sql`
        SELECT id FROM deal_reviews
         WHERE published_at IS NULL AND publish_due_at <= now()
         ORDER BY publish_due_at, id
         LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED`);
      for (const { id } of rows as Array<{ id: string }>) {
        try {
          published += await effectsTx(tx, async (sp) => {
            const done = (await sp
              .update(dealReviews)
              .set({ publishedAt: sql`now()` })
              .where(and(eq(dealReviews.id, id), isNull(dealReviews.publishedAt)))
              .returning()) as ReviewRow[];
            if (done.length === 0) return 0;
            const [deal] = await sp
              .select({ id: deals.id, ref: deals.ref, listingTitle: deals.listingTitle })
              .from(deals)
              .where(eq(deals.id, done[0]!.dealId));
            if (deal) await notifyPublished(sp, done, deal);
            return done.length;
          });
        } catch (err) {
          app.log.warn({ err, job: 'review-publish', reviewId: id }, 'review publish failed');
        }
      }
      return rows.length;
    });
    // A full batch that published nothing (every row failed) would loop: stop and retry next run.
    if (claimed < BATCH || published === before) break;
  }
  if (published > 0) app.log.info({ job: 'review-publish', published }, 'reviews published');
  return published;
}
