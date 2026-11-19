import { and, asc, eq, lte, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { deals } from '../../db/schema.js';
import { Sentry } from '../../lib/sentry.js';
import { runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { lockListingOnly } from '../listings/locks.js';
import { getSettings } from '../settings.service.js';
import { afterDealChange, completeDeal, notifyDealSide } from './deal.service.js';
import type { DealRow } from './deal-view.js';

/**
 * Deal jobs (F6 + F7 spec §9.3, §14, §27 15; ported from textile `services/deals/deal-jobs.service.ts`). Run from
 * `jobs/index.ts`. Each reads candidate ids **unlocked**, then per deal in a transaction of its own (`runJobTx`, so
 * the deal's emits and notifications behave as a route's): locks the listing, then the deal `FOR UPDATE SKIP LOCKED`
 * with the due condition re-checked in the query, and does the work. A deal another write holds is skipped (that write
 * decides it; the next tick looks again), so two runs at once change each deal once. A failing deal is logged and
 * skipped; the rest go on.
 */

const BATCH = 100;

async function sweep(
  app: TxApp,
  job: string,
  due: () => SQL,
  order: SQL,
  work: (tx: Tx, deal: DealRow) => Promise<boolean>,
): Promise<number> {
  let done = 0;
  for (;;) {
    const candidates = await app.db
      .select({ id: deals.id, listingId: deals.listingId })
      .from(deals)
      .where(due())
      .orderBy(order)
      .limit(BATCH);
    let changed = 0;
    for (const c of candidates) {
      try {
        const ok = await runJobTx(app, async (tx) => {
          await lockListingOnly(tx, c.listingId);
          const [deal] = await tx
            .select()
            .from(deals)
            .where(and(eq(deals.id, c.id), due()))
            .for('update', { skipLocked: true });
          return deal ? work(tx, deal) : false;
        });
        if (ok) changed++;
      } catch (err) {
        app.log.error({ err, job, dealId: c.id }, 'deal job failed on a deal');
        Sentry.captureException(err, { tags: { job }, extra: { dealId: c.id } });
      }
    }
    done += changed;
    // A batch that changed nothing is all locked or failing: the next tick tries again.
    if (candidates.length < BATCH || changed === 0) break;
  }
  return done;
}

/**
 * `deal-auto-complete` (every 5 min, §9.3): `handed_over` deals past `auto_complete_at` complete (`auto`) through the
 * same function as the buyer's confirm: hold converted, offers reconciled, both sides told. A disputed deal fails the
 * re-check; a pending cancel request lapses.
 */
export async function autoCompleteDeals(app: TxApp): Promise<number> {
  const due = () => and(eq(deals.status, 'handed_over'), lte(deals.autoCompleteAt, sql`now()`))!;
  return sweep(app, 'deal-auto-complete', due, asc(deals.autoCompleteAt), async (tx, deal) => {
    const updated = await completeDeal(tx, deal, 'auto', { side: 'system', userId: null }, ['handed_over']);
    if (!updated) return false;
    await afterDealChange(tx, updated);
    return true;
  });
}

/**
 * `deal-agreed-reminder` (daily, §9.3): deals still `agreed` after `deal_agreed_reminder_days`, not nudged within that
 * period, get `deal_agreed_reminder` on both sides (no auto-cancel, §27 6) and `agreed_reminded_at` stamped. The dedupe
 * key carries the stamp, so the next period's nudge is a new row.
 */
export async function remindAgreedDeals(app: TxApp): Promise<number> {
  const days = (await getSettings(app.db)).deal_agreed_reminder_days;
  const period = sql`make_interval(days => ${days}::int)`;
  const due = () =>
    and(
      eq(deals.status, 'agreed'),
      lte(deals.acceptedAt, sql`now() - ${period}`),
      sql`(${deals.agreedRemindedAt} IS NULL OR ${deals.agreedRemindedAt} <= now() - ${period})`,
    )!;
  return sweep(app, 'deal-agreed-reminder', due, asc(deals.acceptedAt), async (tx, deal) => {
    const [stamped] = await tx
      .update(deals)
      .set({ agreedRemindedAt: sql`now()` })
      .where(eq(deals.id, deal.id))
      .returning({ at: deals.agreedRemindedAt });
    const key = `deal_agreed_reminder:${deal.id}:${stamped!.at!.toISOString()}`;
    await notifyDealSide(tx, deal, 'buyer', 'deal_agreed_reminder', key);
    await notifyDealSide(tx, deal, 'seller', 'deal_agreed_reminder', key);
    return true;
  });
}
