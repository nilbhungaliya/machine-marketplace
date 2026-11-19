import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { chatMessages, notifications, offers } from '../src/db/schema.js';
import type { TxApp } from '../src/lib/tx-effects.js';
import { expireOffers, notifyExpiringOffers } from '../src/services/offers/offer-jobs.js';
import { insertTestOffer, insertTestThread } from './_helpers/test-deals.js';
import { call, createOfferWorld, offerListing, offerRow, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-5: the offer jobs (F6 + F7 spec §7.9, §14): expiry by the database clock, backups past their limit, the
// expiring-soon notice once per `expires_at`.

let w: OfferWorld;
let restore: () => Promise<void>;
const noop = () => undefined;
const jobApp = { db, log: { warn: noop, error: noop, info: noop } } as unknown as TxApp;

async function sendOffer(listingId: string, buyer = 0): Promise<string> {
  const res = await call(w.app, w.buyers[buyer]!.token, 'POST', `/listings/${listingId}/offers`, { kind: 'offer', pricePerUnitPaise: 90_000, quantity: '1' });
  expect(res.statusCode).toBe(200);
  return res.json().data.offer.id;
}
const expiredLines = async (threadId: string) =>
  (await db.select({ n: count() }).from(chatMessages).where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.systemCode, 'offer_expired'))))[0]!.n;
const expiringNotices = async (offerId: string) =>
  (await db.select({ n: count() }).from(notifications).where(and(eq(notifications.offerId, offerId), eq(notifications.type, 'offer_expiring'))))[0]!.n;

beforeAll(async () => {
  w = await createOfferWorld(2);
  restore = await setTestSettings({
    offer_open_limit_unverified: 50,
    enquiry_new_per_day_unverified: 100,
    offer_backup_max_days: 14,
    offer_expiring_notice_hours: 6,
  });
});

afterAll(async () => {
  await restore?.();
  await w?.cleanup();
});

describe('offer-expiry', () => {
  it('expires only due pending rows, once, even with two runs at once', async () => {
    const due = await sendOffer(await offerListing(w));
    const notDue = await sendOffer(await offerListing(w));
    await db.update(offers).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(offers.id, due));

    const [a, b] = await Promise.all([expireOffers(jobApp), expireOffers(jobApp)]);
    expect(a.expired + b.expired).toBe(1);
    expect((await offerRow(due)).status).toBe('expired');
    expect((await offerRow(notDue)).status).toBe('pending');
    expect(await expiredLines((await offerRow(due)).threadId)).toBe(1);
    // A later run finds nothing.
    expect((await expireOffers(jobApp)).expired).toBe(0);
  });

  it('expires a backup older than offer_backup_max_days (15 days), not a younger one (13 days)', async () => {
    const listingId = await offerListing(w);
    const old = await insertTestOffer({
      threadId: (await insertTestThread({ listingId, buyerBusinessId: w.buyers[0]!.businessId, buyerUserId: w.buyers[0]!.userId })).id,
      status: 'backup',
      pricePerUnitPaise: 90_000,
      quantity: '9',
    });
    const young = await insertTestOffer({
      threadId: (await insertTestThread({ listingId, buyerBusinessId: w.buyers[1]!.businessId, buyerUserId: w.buyers[1]!.userId })).id,
      status: 'backup',
      pricePerUnitPaise: 90_000,
      quantity: '9',
    });
    await db.update(offers).set({ backupSince: sql`now() - interval '15 days'` }).where(eq(offers.id, old.id));
    await db.update(offers).set({ backupSince: sql`now() - interval '13 days'` }).where(eq(offers.id, young.id));
    await expireOffers(jobApp);
    expect((await offerRow(old.id)).status).toBe('expired');
    expect((await offerRow(young.id)).status).toBe('backup');
  });
});

describe('offer-expiring-soon', () => {
  it('notifies the turn side once per expires_at, and again for a new expires_at (a revived offer)', async () => {
    const id = await sendOffer(await offerListing(w));
    await db.update(offers).set({ expiresAt: sql`now() + interval '2 hours'` }).where(eq(offers.id, id));
    expect((await notifyExpiringOffers(jobApp)).notified).toBe(1);
    // Already told for this expires_at: excluded from the scan.
    expect((await notifyExpiringOffers(jobApp)).notified).toBe(0);
    expect(await expiringNotices(id)).toBe(1);
    const [row] = await db.select().from(notifications).where(and(eq(notifications.offerId, id), eq(notifications.type, 'offer_expiring')));
    expect(row!.businessId).toBe(w.seller.businessId);

    // Revived (or reconfirmed) with a fresh validity: its own notice.
    await db.update(offers).set({ expiresAt: sql`now() + interval '3 hours'` }).where(eq(offers.id, id));
    await notifyExpiringOffers(jobApp);
    expect(await expiringNotices(id)).toBe(2);

    // Outside the notice window: nothing.
    const later = await sendOffer(await offerListing(w));
    await notifyExpiringOffers(jobApp);
    expect(await expiringNotices(later)).toBe(0);
  });
});
