import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { businessBlocks, businesses, categories, partRequests, users } from '../src/db/schema.js';
import { eligibleSellerCount, isEligibleSeller, requestRoleFor } from '../src/services/part-requests/eligibility.js';
import { writeRequestStatus } from '../src/services/part-requests/lifecycle.js';
import { replyFitReason, replyFitReasons } from '../src/services/part-requests/reply-fit.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// F8 eligibility (spec §6; plan C0-3a): each condition flips `isEligibleSeller` on real rows, starting from a baseline
// eligible seller. Plus the role helper, the status writer's refusals and the pure reply fit.

let tree: TestPartTree;
let buyer: TestBusinessUser;
let request: TestPartRequestRow;
const sellers: TestSeller[] = [];
const businessIds: string[] = [];

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: tree.machineCategory.id, ...opts });
  sellers.push(s);
  businessIds.push(s.businessId);
  return s;
}

const eligible = (businessId: string, requestId = request.id) => isEligibleSeller(db, requestId, businessId);
const setOwnerStatus = (businessId: string, status: 'active' | 'suspended') =>
  db.update(users).set({ status }).where(eq(users.businessId, businessId));

beforeAll(async () => {
  tree = await createTestPartTree();
  buyer = await createTestBusinessUser();
  businessIds.push(buyer.businessId);
  await db.update(businesses).set({ pincode: '990011', city: 'Surat', state: 'Gujarat' }).where(eq(businesses.id, buyer.businessId));
  request = await insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.machineType.id, unitId: tree.unitId, side: 'left',
  });
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await tree.cleanup();
});

describe('eligibleSellerSql (§6)', () => {
  it('a baseline seller (profile category + sell) is eligible; own business never', async () => {
    const s = await seller();
    expect(await eligible(s.businessId)).toBe(true);
    expect(await eligible(buyer.businessId)).toBe(false);
  });

  it('1. a seller without a finished location, or with a suspended owner, is not', async () => {
    expect(await eligible((await seller({ onboarded: false })).businessId)).toBe(false);
    const s = await seller();
    await setOwnerStatus(s.businessId, 'suspended');
    expect(await eligible(s.businessId)).toBe(false);
  });

  it("2. a suspended buyer owner hides the request; reinstating brings it back", async () => {
    const s = await seller();
    await setOwnerStatus(buyer.businessId, 'suspended');
    try {
      expect(await eligible(s.businessId)).toBe(false);
    } finally {
      await setOwnerStatus(buyer.businessId, 'active');
    }
    expect(await eligible(s.businessId)).toBe(true);
  });

  it('3. a block either way', async () => {
    const s = await seller();
    for (const [blocker, blocked, by] of [
      [buyer.businessId, s.businessId, buyer.userId],
      [s.businessId, buyer.businessId, s.userId],
    ] as const) {
      await db.insert(businessBlocks).values({ blockerBusinessId: blocker, blockedBusinessId: blocked, createdByUserId: by });
      expect(await eligible(s.businessId)).toBe(false);
      await db.delete(businessBlocks).where(eq(businessBlocks.blockerBusinessId, blocker));
    }
    expect(await eligible(s.businessId)).toBe(true);
  });

  it('4. verified_only needs GST; any_seller does not', async () => {
    const s = await seller();
    await db.update(partRequests).set({ audience: 'verified_only' }).where(eq(partRequests.id, request.id));
    try {
      expect(await eligible(s.businessId)).toBe(false);
    } finally {
      await db.update(partRequests).set({ audience: 'any_seller' }).where(eq(partRequests.id, request.id));
    }
    expect(await eligible(s.businessId)).toBe(true);
  });

  it('5a. a profile category needs the sell activity', async () => {
    expect(await eligible((await seller({ activities: ['buy'] })).businessId)).toBe(false);
    expect(await eligible((await seller({ activities: ['buy', 'sell'] })).businessId)).toBe(true);
  });

  it("5b. without the profile category: a live listing in the request's subtree only", async () => {
    // createTestSeller without machineCategoryId gives the seller a machine category of its own.
    const make = () => createTestSeller({}).then((s) => (sellers.push(s), businessIds.push(s.businessId), s));
    const child = await make();
    expect(await eligible(child.businessId)).toBe(false);
    await insertTestListing(db, { businessId: child.businessId, userId: child.userId, kind: 'part', categoryId: tree.partGroup.id });
    expect(await eligible(child.businessId)).toBe(true);

    const [sibling] = await db
      .insert(categories)
      .values({
        parentId: tree.machineCategory.id, level: 'machine_type', name: 'Test Sibling', slug: 'test-sibling',
        path: `${tree.machineCategory.path}/test-sibling`,
      })
      .returning({ id: categories.id });
    const other = await make();
    await insertTestListing(db, { businessId: other.businessId, userId: other.userId, kind: 'machine', categoryId: sibling!.id });
    expect(await eligible(other.businessId)).toBe(false);

    const paused = await make();
    await insertTestListing(db, {
      businessId: paused.businessId, userId: paused.userId, kind: 'part', categoryId: tree.partGroup.id, status: 'paused',
    });
    expect(await eligible(paused.businessId)).toBe(false);
  });

  it('6. a request that left active hides, except from a seller with a reply on it', async () => {
    const closed = await insertTestPartRequest({
      businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.machineType.id, unitId: tree.unitId, status: 'closed',
    });
    const a = await seller();
    const b = await seller();
    const { id: listingId } = await insertTestListing(db, {
      businessId: b.businessId, userId: b.userId, kind: 'part', categoryId: tree.partGroup.id, side: 'left',
    });
    await insertTestReply({ partRequestId: closed.id, sellerBusinessId: b.businessId, listingId, userId: b.userId });
    expect(await eligible(a.businessId, closed.id)).toBe(false);
    expect(await eligible(b.businessId, closed.id)).toBe(true);
  });

  it('eligibleSellerCount matches the eligible fixtures; requestRoleFor answers buyer / seller / null', async () => {
    let expected = 0;
    for (const s of sellers) if (await eligible(s.businessId)) expected++;
    expect(await eligibleSellerCount(db, request.id)).toBe(expected);

    const s = sellers[0]!;
    expect(await requestRoleFor(db, request.id, buyer.businessId)).toBe('buyer');
    expect(await requestRoleFor(db, request.id, s.businessId)).toBe('seller');
    const ineligible = await seller({ activities: ['buy'] });
    expect(await requestRoleFor(db, request.id, ineligible.businessId)).toBeNull();
  });
});

describe('writeRequestStatus (§9.1)', () => {
  it('refuses a second close and a stale row', async () => {
    const r = await insertTestPartRequest({
      businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.machineType.id, unitId: tree.unitId,
    });
    const closed = await db.transaction((tx) => writeRequestStatus(tx, r, 'close', { closeReason: 'found_elsewhere' }));
    expect(closed).toMatchObject({ status: 'closed', closeReason: 'found_elsewhere' });
    expect(closed.closedAt).not.toBeNull();
    await expect(db.transaction((tx) => writeRequestStatus(tx, closed, 'close', { closeReason: 'other' }))).rejects.toMatchObject({
      statusCode: 409, code: 'PART_REQUEST_TRANSITION_NOT_ALLOWED', details: { from: 'closed', action: 'close' },
    });
    // `r` still says active: the conditional UPDATE matches nothing.
    await expect(db.transaction((tx) => writeRequestStatus(tx, r, 'fulfil'))).rejects.toMatchObject({
      code: 'PART_REQUEST_TRANSITION_NOT_ALLOWED', details: { from: 'closed', action: 'fulfil' },
    });
    const [row] = await db.select({ status: partRequests.status }).from(partRequests).where(eq(partRequests.id, r.id));
    expect(row!.status).toBe('closed');
  });
});

describe('replyFitReason (§9.2)', () => {
  const req = { kind: 'part' as const, side: 'left' as const, conditionIds: ['c1'], rootPath: 'textile' };
  const ok = { kind: 'part' as const, side: 'pair' as const, conditionId: 'c1', categoryPath: 'textile/loom/temples' };
  it.each([
    [{ ...ok, kind: 'machine' as const }, 'kind'],
    [{ ...ok, categoryPath: 'textiles/loom' }, 'category'],
    [{ ...ok, categoryPath: null }, 'category'],
    [{ ...ok, side: 'right' as const }, 'side'],
    [{ ...ok, conditionId: 'c2' }, 'condition'],
    [ok, null],
    [{ ...ok, categoryPath: 'textile' }, null],
  ])('%o → %s', (listing, want) => {
    expect(replyFitReason(req, listing)).toBe(want);
  });

  it('an empty condition list accepts any condition', () => {
    expect(replyFitReason({ ...req, conditionIds: [] }, { ...ok, conditionId: null })).toBeNull();
  });
});

describe('replyFitReasons (§9.2)', () => {
  // Review fix I1: the unique key covers every reply status, so a dropped reply still blocks a second one.
  it('a listing with a dropped reply is replied; a fitting listing without one fits', async () => {
    const s = await seller();
    const listing = (side: 'left' | 'pair') => insertTestListing(db, {
      businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: tree.partGroup.id, side,
    });
    const dropped = await listing('left');
    const fresh = await listing('pair');
    await insertTestReply({
      partRequestId: request.id, sellerBusinessId: s.businessId, listingId: dropped.id, userId: s.userId,
      status: 'dropped', dropReason: 'no_longer_fits',
    });
    const fit = await replyFitReasons(db, request, [dropped.id, fresh.id]);
    expect(fit.get(dropped.id)).toBe('replied');
    expect(fit.get(fresh.id)).toBeNull();
  });
});
