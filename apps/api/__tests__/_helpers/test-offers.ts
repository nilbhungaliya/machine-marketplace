import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { AppSettingKey } from '@mpm/shared-types';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { appSettings, offers, units, users } from '../../src/db/schema.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './test-catalog.js';
import { deleteTestRedisKeys } from './test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, deleteTestUnits, insertTestListing, type TestListingOptions, type TestSeller } from './test-listings.js';

// L2 offers fixtures (F6 + F7 plan Lane L2): one seller, several buyers, a catalogue with a 0-decimal unit and a
// 3-decimal unit, listings with each price model, and the app. Everything goes in `cleanup()`.

export interface OfferWorld {
  app: FastifyInstance;
  catalog: TestCatalog;
  /** A unit with 3 decimals (the catalogue's own has 0). */
  decimalUnitId: string;
  seller: TestSeller;
  buyers: TestBusinessUser[];
  cleanup: () => Promise<void>;
}

const extraBusinessIds: string[] = [];

export async function createOfferWorld(buyerCount = 3): Promise<OfferWorld> {
  const app = await buildApp({ logger: false });
  const catalog = await createTestCatalog();
  const [unit] = await db
    .insert(units)
    .values({ key: `test_dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, label: 'Test kg', decimals: 3, sortOrder: 9999 })
    .returning({ id: units.id });
  const seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  const buyers: TestBusinessUser[] = [];
  for (let i = 0; i < buyerCount; i++) buyers.push(await createTestBusinessUser());
  const world: OfferWorld = {
    app,
    catalog,
    decimalUnitId: unit!.id,
    seller,
    buyers,
    cleanup: async () => {
      const ids = [seller.businessId, ...buyers.map((b) => b.businessId), ...extraBusinessIds.splice(0)];
      await deleteTestBusinesses(ids);
      await deleteTestSellerExtras([seller]);
      await deleteTestCatalog(catalog.categoryId);
      await deleteTestUnits([unit!.id]);
      if (app.redis) await deleteTestRedisKeys(app.redis);
      await app.close();
    },
  };
  return world;
}

/** Another buyer business cleaned up with the world. */
export async function extraBuyer(): Promise<TestBusinessUser> {
  const b = await createTestBusinessUser();
  extraBusinessIds.push(b.businessId);
  return b;
}

/** Another seller business (and its extras) cleaned up with the world's businesses. */
export async function extraSeller(machineCategoryId: string): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId });
  extraBusinessIds.push(s.businessId);
  return s;
}

/** A live part listing of `seller` (default the world's): negotiable, ₹1 000 a unit, quantity 5, the 0-decimal unit. */
export async function offerListing(world: OfferWorld, extra: Partial<TestListingOptions> = {}, seller: TestSeller = world.seller): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: world.catalog.motorsGroupId,
    unitId: world.catalog.unitId,
    conditionId: world.catalog.conditionId,
    quantity: '5',
    priceModel: 'negotiable',
    pricePaise: 100_000,
    ...extra,
  });
  return id;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** An API call as `token`, with an optional `Idempotency-Key`. */
export function call(
  app: FastifyInstance,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
  idempotencyKey?: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { ...auth(token), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    ...(payload ? { payload } : {}),
  });
}

export const newKey = (): string => randomUUID();

/** Sets settings for a suite; returns the restore (deletes what wasn't there, puts back what was). */
export async function setTestSettings(values: Partial<Record<AppSettingKey, number>>): Promise<() => Promise<void>> {
  const keys = Object.keys(values) as AppSettingKey[];
  const before = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  for (const key of keys) {
    await db
      .insert(appSettings)
      .values({ key, value: values[key]! })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: values[key]! } });
  }
  return async () => {
    await db.delete(appSettings).where(inArray(appSettings.key, keys));
    if (before.length) await db.insert(appSettings).values(before);
  };
}

export async function offerRow(id: string) {
  const [row] = await db.select().from(offers).where(eq(offers.id, id));
  return row!;
}

/** Sets a user's member role (owner, listing_manager, sales, viewer). */
export async function setRole(userId: string, role: 'owner' | 'listing_manager' | 'sales' | 'viewer'): Promise<void> {
  await db.update(users).set({ memberRole: role }).where(eq(users.id, userId));
}
