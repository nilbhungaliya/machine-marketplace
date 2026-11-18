import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { ListingKind, ListingStatus } from '@mpm/shared-types';
import { db, pool } from '../src/db/index.js';
import { appSettings, listingStatusHistory, listings } from '../src/db/schema.js';
import { allJobs } from '../src/jobs/index.js';
import { runListingExpiry } from '../src/services/listings/listing-jobs.service.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestSeller,
} from './_helpers/test-listings.js';

// The expiry job (F2 plan Task 15, spec §7.4, amendment 1): live and rented listings older than the expiry setting
// expire (actor `system`); others wait; a listing another transaction holds is skipped; a held business lock never
// blocks the job. Every run is scoped to this suite's businesses, so other suites' fixtures are never touched.

const DAY = 24 * 60 * 60 * 1000;
let catalog: TestCatalog;
let machineUnit: { id: string; key: string };
const sellers: TestSeller[] = [];

async function seller(): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, gst: true });
  sellers.push(s);
  return s;
}

const run = () => runListingExpiry(db, { businessIds: sellers.map((s) => s.businessId) });

async function listing(s: TestSeller, status: ListingStatus, daysAgo: number, kind: ListingKind = 'part'): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status,
    categoryId: kind === 'part' ? catalog.motorsGroupId : catalog.machineTypeId,
    unitId: kind === 'part' ? catalog.unitId : machineUnit.id,
    conditionId: catalog.conditionId,
    refreshedAt: new Date(Date.now() - daysAgo * DAY),
  });
  return id;
}

const statusOf = async (id: string) => (await db.select({ s: listings.status }).from(listings).where(eq(listings.id, id)))[0]!.s;

beforeAll(async () => {
  catalog = await createTestCatalog();
  machineUnit = await createTestMachineUnit();
});

afterEach(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, 'listing_expiry_days'));
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
});

describe('runListingExpiry', () => {
  it('expires live and rented listings past 60 days (actor system), and leaves the rest', async () => {
    const s = await seller();
    const old = await listing(s, 'live', 61);
    const fresh = await listing(s, 'live', 59);
    const rented = await listing(s, 'rented', 61, 'machine_rental');
    const paused = await listing(s, 'paused', 100);

    const { expired } = await run();
    expect(expired).toBe(2);
    expect(await statusOf(old)).toBe('expired');
    expect(await statusOf(rented)).toBe('expired');
    expect(await statusOf(fresh)).toBe('live');
    expect(await statusOf(paused)).toBe('paused');

    const [h] = await db
      .select()
      .from(listingStatusHistory)
      .where(eq(listingStatusHistory.listingId, old))
      .orderBy(desc(listingStatusHistory.createdAt));
    expect(h).toMatchObject({ fromStatus: 'live', toStatus: 'expired', action: 'expire', actor: 'system', userId: null, adminId: null });
    expect((await run()).expired).toBe(0);
  });

  it('reads listing_expiry_days on every run', async () => {
    const s = await seller();
    const id = await listing(s, 'live', 31);
    await run();
    expect(await statusOf(id)).toBe('live');
    await db.insert(appSettings).values({ key: 'listing_expiry_days', value: 30 });
    await run();
    expect(await statusOf(id)).toBe('expired');
  });

  it('skips a listing another transaction holds, and a renew committed by that transaction wins', async () => {
    const s = await seller();
    const held = await listing(s, 'live', 70);
    const free = await listing(s, 'live', 70);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM listings WHERE id = $1 FOR UPDATE', [held]);
      const { expired } = await run();
      expect(expired).toBe(1);
      expect(await statusOf(free)).toBe('expired');
      // The other transaction renews the listing and commits.
      await client.query('UPDATE listings SET refreshed_at = now() WHERE id = $1', [held]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await run();
    expect(await statusOf(held)).toBe('live');
  });

  it('finishes while another transaction holds the business lock', async () => {
    const s = await seller();
    const id = await listing(s, 'live', 65);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM businesses WHERE id = $1 FOR NO KEY UPDATE', [s.businessId]);
      const outcome = await Promise.race([
        run().then((r) => r.expired),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ]);
      expect(outcome).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await statusOf(id)).toBe('expired');
    const rows = await db
      .select({ id: listingStatusHistory.id })
      .from(listingStatusHistory)
      .where(and(eq(listingStatusHistory.listingId, id), eq(listingStatusHistory.action, 'expire')));
    expect(rows).toHaveLength(1);
  });
});

describe('allJobs', () => {
  it('includes listing-expiry, hourly, first run after a minute', () => {
    const jobs = allJobs({ db, log: { info: () => undefined } } as unknown as FastifyInstance);
    expect(jobs.find((j) => j.name === 'listing-expiry')).toMatchObject({ everyMs: 3_600_000, firstRunMs: 60_000 });
  });
});
