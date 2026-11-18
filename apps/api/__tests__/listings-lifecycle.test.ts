import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { LISTING_TRANSITIONS, type ListingKind, type ListingStatus, type SellerListingAction } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listingMedia, listingStatusHistory, listings, reports } from '../src/db/schema.js';
import { applyAdminTransition } from '../src/services/listings/listing-lifecycle.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses, revokeTestGst } from './_helpers/test-businesses.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// The state machine and seller actions (F2 plan Task 9, spec §7.2): every seller row from each allowed status, one
// refused status per action, the gate on resume / renew / relist / end of rental, GST on rentals, the relist cap,
// races, and the admin transitions Task 16 will route (amendments 2 and 4).

let app: FastifyInstance;
let catalog: TestCatalog;
let machineUnit: { id: string; key: string };
let admin: { id: string; token: string };
const sellers: TestSeller[] = [];

const auth = (s: TestSeller) => ({ authorization: `Bearer ${s.token}` });
const act = (s: TestSeller, id: string, action: string, note?: string) =>
  app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: auth(s), payload: note ? { action, note } : { action } });
const patch = (s: TestSeller, id: string, body: object) =>
  app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(s), payload: body });

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, ...opts });
  sellers.push(s);
  return s;
}

const RENTAL_ONLY: readonly SellerListingAction[] = ['mark_rented', 'end_rental'];

/** A complete listing of the kind an action needs (rentals for mark_rented / end_rental), in `status`. */
const listingOf = (s: TestSeller, status: ListingStatus, kind: ListingKind = 'part', extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status,
    categoryId: kind === 'part' ? catalog.motorsGroupId : catalog.machineTypeId,
    unitId: kind === 'part' ? catalog.unitId : machineUnit.id,
    conditionId: kind === 'machine_rental' ? null : catalog.conditionId,
    quantity: kind === 'part' ? '10' : '1',
    ...(kind === 'part' ? {} : { machine: { brandOther: 'Local make' } }),
    returnStatus: status === 'hidden' ? 'live' : null,
    ...extra,
  }).then((r) => r.id);

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  machineUnit = await createTestMachineUnit();
  admin = await createTestAdmin('moderator');
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('seller rows of §7.2', () => {
  const rows = LISTING_TRANSITIONS.filter((t) => t.actor === 'seller' && t.action !== 'publish');

  it('moves from every allowed status, with a seller history row', async () => {
    const s = await seller({ gst: true });
    let checked = 0;
    for (const t of rows) {
      for (const from of t.from) {
        const kind: ListingKind = RENTAL_ONLY.includes(t.action as SellerListingAction) ? 'machine_rental' : 'part';
        const id = await listingOf(s, from, kind);
        const res = await act(s, id, t.action);
        expect(res.statusCode, `${t.action} from ${from}: ${res.body}`).toBe(200);
        // A verified seller's go-live actions meet no review reason here: the gate answers live.
        const expected = t.to === 'gate' ? 'live' : t.to;
        expect(res.json().data.outcome, `${t.action} from ${from}`).toBe(expected);
        expect((await rowOf(id)).status).toBe(expected);
        const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
        expect(history).toEqual([
          expect.objectContaining({ fromStatus: from, toStatus: expected, action: t.action, actor: 'seller', userId: s.userId }),
        ]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(24);
  });

  it('refuses one disallowed status per action with 409 and details', async () => {
    const s = await seller({ gst: true });
    const refused: Array<[SellerListingAction, ListingStatus]> = [
      ['pause', 'paused'],
      ['resume', 'live'],
      ['renew', 'paused'],
      ['mark_sold', 'sold'],
      ['mark_unavailable', 'sold'],
      ['relist', 'live'],
      ['mark_rented', 'paused'],
      ['end_rental', 'live'],
      ['remove', 'removed'],
    ];
    for (const [action, from] of refused) {
      const id = await listingOf(s, from, RENTAL_ONLY.includes(action) ? 'machine_rental' : 'part');
      const res = await act(s, id, action);
      expect(res.statusCode, `${action} from ${from}`).toBe(409);
      expect(res.json()).toMatchObject({ code: 'LISTING_TRANSITION_NOT_ALLOWED', details: { from, action } });
      expect((await rowOf(id)).status).toBe(from);
    }
  });

  it('refuses mark_rented on a part, and an unknown action', async () => {
    const s = await seller();
    const id = await listingOf(s, 'live');
    const res = await act(s, id, 'mark_rented');
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toEqual({ from: 'live', action: 'mark_rented' });
    expect((await act(s, id, 'duplicate')).statusCode).toBe(400);
    expect((await act(s, id, 'approve')).statusCode).toBe(400);
  });

  it("can't resume a hidden listing but can remove it, keeping the moderator's reason", async () => {
    const s = await seller();
    const id = await listingOf(s, 'hidden', 'part', { statusReason: 'Stock photos' });
    expect((await act(s, id, 'resume')).statusCode).toBe(409);
    const removed = await act(s, id, 'remove');
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: 'removed', statusReason: 'Stock photos' });
  });

  it('stores the note of mark_unavailable and remove as the status reason', async () => {
    const s = await seller();
    const id = await listingOf(s, 'live');
    expect((await act(s, id, 'mark_unavailable', 'Out on loan')).statusCode).toBe(200);
    expect((await rowOf(id)).statusReason).toBe('Out on loan');
    const other = await listingOf(s, 'paused');
    expect((await act(s, other, 'remove', 'Sold elsewhere')).statusCode).toBe(200);
    expect((await rowOf(other)).statusReason).toBe('Sold elsewhere');
  });

  it("answers 404 for another business's listing", async () => {
    const s = await seller();
    const other = await seller();
    expect((await act(other, await listingOf(s, 'live'), 'pause')).statusCode).toBe(404);
  });
});

describe('the gate on go-live actions', () => {
  it('sends a paused listing edited to ₹4 to review on resume, with return_status live', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'paused');
    expect((await patch(s, id, { pricePaise: 400 })).json().data.status).toBe('paused');
    const res = await act(s, id, 'resume');
    expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['price_check'] } });
    expect((await rowOf(id)).returnStatus).toBe('live');
  });

  it('sends an expired listing edited to ₹4 to review on renew', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'expired');
    expect((await patch(s, id, { pricePaise: 400 })).statusCode).toBe(200);
    const res = await act(s, id, 'renew');
    expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['price_check'] } });
  });

  it('sends end of rental to review for a flag stored while it was rented', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'rented', 'machine_rental', { flags: ['price_check'] });
    const res = await act(s, id, 'end_rental');
    expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['price_check'] } });
    expect((await rowOf(id)).returnStatus).toBe('live');
  });

  it('keeps an accepted flag from blocking a resume', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'paused', 'part', { pricePaise: 400, flags: ['price_check'], acceptedFlags: ['price_check'] });
    expect((await act(s, id, 'resume')).json().data.outcome).toBe('live');
  });

  it('refuses resume of a rental whose business lost GST, but still pauses one', async () => {
    const s = await seller({ gst: true });
    const paused = await listingOf(s, 'paused', 'machine_rental');
    const live = await listingOf(s, 'live', 'machine_rental');
    await revokeTestGst(s.businessId);
    const res = await act(s, paused, 'resume');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('RENTAL_NEEDS_GST');
    expect((await act(s, live, 'pause')).statusCode).toBe(200);
    expect((await act(s, live, 'remove')).statusCode).toBe(200);
  });

  it('relists from unavailable at the cap (pending_review, unverified_seller) but not from sold', async () => {
    const s = await seller();
    await listingOf(s, 'live');
    await listingOf(s, 'paused');
    const unavailable = await listingOf(s, 'unavailable');
    const sold = await listingOf(s, 'sold');

    const fromSold = await act(s, sold, 'relist');
    expect(fromSold.statusCode).toBe(409);
    expect(fromSold.json()).toMatchObject({ code: 'UNVERIFIED_LISTING_CAP', details: { cap: 3 } });
    expect((await rowOf(sold)).status).toBe('sold');

    const fromUnavailable = await act(s, unavailable, 'relist');
    expect(fromUnavailable.statusCode, fromUnavailable.body).toBe(200);
    expect(fromUnavailable.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['unverified_seller'] } });
  });

  it('doesn\'t review resume for an unverified business (already approved)', async () => {
    const s = await seller();
    const id = await listingOf(s, 'paused');
    expect((await act(s, id, 'resume')).json().data.outcome).toBe('live');
  });

  it('refreshes on renew', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'expired', 'part', { refreshedAt: new Date(Date.now() - 70 * 86_400_000) });
    expect((await act(s, id, 'renew')).statusCode).toBe(200);
    const row = await rowOf(id);
    expect(row.status).toBe('live');
    expect(row.refreshedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('races', () => {
  it('two concurrent pauses: one wins, the other is 409', async () => {
    const s = await seller();
    const id = await listingOf(s, 'live');
    const results = await Promise.all([act(s, id, 'pause'), act(s, id, 'pause')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('LISTING_TRANSITION_NOT_ALLOWED');
    const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
    expect(history).toHaveLength(1);
  });
});

describe('applyAdminTransition', () => {
  const run = (id: string, action: Parameters<typeof applyAdminTransition>[3], opts?: Parameters<typeof applyAdminTransition>[4]) =>
    db.transaction(async (tx) => applyAdminTransition(tx, admin.id, await rowOf(id), action, opts));

  it('approve after a back-to-review returns to return_status, accepts the flags and clears the reasons', async () => {
    const s = await seller({ gst: true });
    const id = await listingOf(s, 'pending_review', 'machine_rental', {
      returnStatus: 'rented', flags: ['price_check'], reviewReasons: ['edit_flagged'],
    });
    const row = await run(id, 'approve');
    expect(row).toMatchObject({ status: 'rented', returnStatus: null, reviewReasons: [], acceptedFlags: ['price_check'], moderationOutcome: 'approved', moderatedBy: admin.id });
    const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
    expect(history).toEqual([expect.objectContaining({ action: 'approve', actor: 'admin', adminId: admin.id, toStatus: 'rented' })]);
  });

  it('approve of a first publish goes live and stamps first_live_at', async () => {
    const s = await seller();
    const id = await listingOf(s, 'pending_review', 'part', { firstLiveAt: null, reviewReasons: ['unverified_seller'] });
    const row = await run(id, 'approve');
    expect(row.status).toBe('live');
    expect(row.firstLiveAt).not.toBeNull();
  });

  it('reject and ask for changes after a back-to-review clear return_status (amendment 4)', async () => {
    const s = await seller();
    const a = await listingOf(s, 'pending_review', 'part', { returnStatus: 'live' });
    expect(await run(a, 'reject', { reason: 'Wrong part' })).toMatchObject({
      status: 'rejected', returnStatus: null, moderationOutcome: 'rejected', moderationNote: 'Wrong part',
    });
    const b = await listingOf(s, 'pending_review', 'part', { returnStatus: 'live' });
    expect(await run(b, 'ask_for_changes', { reason: 'Add a real photo' })).toMatchObject({
      status: 'rejected', returnStatus: null, moderationOutcome: 'changes_requested',
    });
  });

  it('refuses approve and unhide of a listing with no photo (400 LISTING_INCOMPLETE, amendment 2)', async () => {
    const s = await seller();
    const pending = await listingOf(s, 'pending_review', 'part', { photos: 0 });
    await expect(run(pending, 'approve')).rejects.toMatchObject({
      statusCode: 400, code: 'LISTING_INCOMPLETE', details: { problems: [{ field: 'photos', code: 'required' }] },
    });
    expect((await rowOf(pending)).status).toBe('pending_review');
    const hidden = await listingOf(s, 'hidden', 'part', { photos: 0 });
    await expect(run(hidden, 'unhide')).rejects.toMatchObject({ statusCode: 400, code: 'LISTING_INCOMPLETE' });
    expect((await rowOf(hidden)).status).toBe('hidden');
  });

  it('hide stores return_status and resolves open reports; unhide restores it and refreshes', async () => {
    const s = await seller();
    const reporter = await seller();
    const id = await listingOf(s, 'paused', 'part', { refreshedAt: new Date(Date.now() - 10 * 86_400_000) });
    await db.execute(sql`
      INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
      VALUES ('listing', ${id}, ${reporter.userId}, ${reporter.businessId}, 'stock_photos')`);
    expect(await run(id, 'hide', { reason: 'Stock photos' })).toMatchObject({ status: 'hidden', returnStatus: 'paused', statusReason: 'Stock photos' });
    const [report] = await db.select().from(reports).where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, id)));
    expect(report).toMatchObject({ status: 'actioned', resolvedBy: admin.id });

    const back = await run(id, 'unhide');
    expect(back).toMatchObject({ status: 'paused', returnStatus: null, statusReason: null });
    expect(back.refreshedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('remove resolves reports and keeps the reason', async () => {
    const s = await seller();
    const reporter = await seller();
    const id = await listingOf(s, 'live');
    await db.execute(sql`
      INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
      VALUES ('listing', ${id}, ${reporter.userId}, ${reporter.businessId}, 'advance_payment')`);
    expect(await run(id, 'remove', { reason: 'Fraud' })).toMatchObject({ status: 'removed', statusReason: 'Fraud' });
    const [report] = await db.select().from(reports).where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, id)));
    expect(report).toMatchObject({ status: 'actioned', resolvedBy: admin.id, resolutionNote: 'Fraud' });
    expect(report!.resolvedAt).not.toBeNull();
  });

  it('refuses approve and unhide of a rental whose business lost GST (403 RENTAL_NEEDS_GST)', async () => {
    const s = await seller({ gst: true });
    const pending = await listingOf(s, 'pending_review', 'machine_rental', { returnStatus: 'live' });
    const hidden = await listingOf(s, 'hidden', 'machine_rental');
    const part = await listingOf(s, 'pending_review');
    await revokeTestGst(s.businessId);
    await expect(run(pending, 'approve')).rejects.toMatchObject({ statusCode: 403, code: 'RENTAL_NEEDS_GST' });
    await expect(run(hidden, 'unhide')).rejects.toMatchObject({ statusCode: 403, code: 'RENTAL_NEEDS_GST' });
    expect((await rowOf(pending)).status).toBe('pending_review');
    expect((await rowOf(hidden)).status).toBe('hidden');
    // Parts don't need GST; and a rental can still be rejected or removed.
    expect((await run(part, 'approve')).status).toBe('live');
    expect((await run(pending, 'reject', { reason: 'GST lapsed' })).status).toBe('rejected');
    expect((await run(hidden, 'remove', { reason: 'GST lapsed' })).status).toBe('removed');
  });

  it('requires a reason of 3–500 characters for reject, ask for changes, hide and remove (400 VALIDATION_ERROR)', async () => {
    const s = await seller();
    const cases: Array<[Parameters<typeof applyAdminTransition>[3], ListingStatus]> = [
      ['reject', 'pending_review'],
      ['ask_for_changes', 'pending_review'],
      ['hide', 'live'],
      ['remove', 'live'],
    ];
    for (const [action, from] of cases) {
      const id = await listingOf(s, from);
      for (const reason of [undefined, null, '  ab  ', 'x'.repeat(501)]) {
        await expect(run(id, action, { reason }), `${action} with ${String(reason)}`).rejects.toMatchObject({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          details: { field: action === 'ask_for_changes' ? 'message' : 'reason' },
        });
      }
      expect((await rowOf(id)).status).toBe(from);
      const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
      expect(history).toHaveLength(0);
      // Trimmed when stored.
      expect((await run(id, action, { reason: '  Good reason  ' })).status).not.toBe(from);
      const [h] = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
      expect(h!.reason).toBe('Good reason');
    }
  });

  it('refuses a stale version (409 LISTING_CHANGED) and a disallowed move', async () => {
    const s = await seller();
    const id = await listingOf(s, 'pending_review', 'part', { version: 3 });
    await expect(run(id, 'approve', { version: 2 })).rejects.toMatchObject({ statusCode: 409, code: 'LISTING_CHANGED' });
    expect((await rowOf(id)).status).toBe('pending_review');
    const live = await listingOf(s, 'live');
    await expect(run(live, 'approve')).rejects.toMatchObject({ code: 'LISTING_TRANSITION_NOT_ALLOWED', details: { from: 'live', action: 'approve' } });
    // The photo rule doesn't apply to hide.
    await db.delete(listingMedia).where(eq(listingMedia.listingId, live));
    expect((await run(live, 'hide', { reason: 'Check' })).status).toBe('hidden');
  });
});
