import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DISCOVERY_LIMITS, type ListingKind, type ListingStatus, type PartSide } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { industrialAreas, listings, savedListings, users } from '../src/db/schema.js';
import { signAdminToken, signUserToken } from '../src/plugins/auth.js';
import { AppError } from '../src/lib/errors.js';
import { loadCards } from '../src/services/listings/listing-view.service.js';
import { discoveryWhere } from '../src/services/discovery/visibility.js';
import { INDIA_BOUNDS, resolveOrigin, snapCoord } from '../src/services/discovery/origin.js';
import { pointSql, snappedKmSql, withinRadiusSql } from '../src/services/discovery/distance.js';
import { relevanceSql, tierSql } from '../src/services/discovery/ranking.js';
import { cursorAad, openCursor, requestHash, sealCursor } from '../src/services/discovery/cursor.js';
import { bumpReaderVersion, readReaderVersion, readerVersionKey } from '../src/services/discovery/reader-version.js';
import { discoveryRateKey, discoveryRateLimits } from '../src/services/discovery/rate-key.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  deleteTestDiscovery,
  deleteTestPincodeOffices,
  deleteTestRedisKeys,
  insertTestPincodeOffices,
  testRunId,
} from './_helpers/test-discovery.js';

// F4 + F5 shared discovery core (spec 2026-11-19-f4-f5-discovery-design §5.5, §5.10, §6, §7, R7, R17, R18; plan B0-3).

const runId = testRunId();
let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let suspendedSeller: TestSeller;
let pinned: TestSeller;
let centroidSeller: TestSeller;
let areaSeller: TestSeller;
let viewer: TestSeller;
let areaId = '';
const officeIds: string[] = [];
const sellers: TestSeller[] = [];

const ENV_KEYS = ['DISCOVERY_RATE_LIMIT_MAX', 'DISCOVERY_IP_RATE_MAX'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// A spot in central India no other suite uses, with a test office right on the snapped grid point.
const GPS = { lat: 23.4567, lng: 80.1234 };
const GPS_SNAPPED = { lat: 23.46, lng: 80.12 };

beforeAll(async () => {
  // Low limits, injected before the app is built (the rate-limit config is read at route registration).
  process.env.DISCOVERY_RATE_LIMIT_MAX = '3';
  process.env.DISCOVERY_IP_RATE_MAX = '10';
  app = await buildApp({ logger: false });

  catalog = await createTestCatalog();
  officeIds.push(...(await insertTestPincodeOffices('990021', [{ ...GPS_SNAPPED, officeName: 'Zztpur', district: 'ZZT DISTRICT' }])));
  officeIds.push(
    ...(await insertTestPincodeOffices('990022', [
      { lat: 22.0, lng: 79.0, officeName: 'Zzt North', district: 'ZZT TWO' },
      { lat: 22.02, lng: 79.0, officeName: 'Zzt South', district: 'ZZT TWO' },
    ])),
  );
  const [area] = await db
    .insert(industrialAreas)
    .values({ name: `Zzt Estate ${runId}`, city: 'Surat', state: 'Gujarat' })
    .returning({ id: industrialAreas.id });
  areaId = area!.id;

  seller = await createTestSeller({ machineCategoryId: catalog.categoryId, point: { lat: 21.17, lng: 72.83 } });
  suspendedSeller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  pinned = await createTestSeller({ machineCategoryId: catalog.categoryId, point: { lat: 21.1834, lng: 72.8211 } });
  centroidSeller = await createTestSeller({
    machineCategoryId: catalog.categoryId,
    pincode: '990023',
    pincodeOffices: [{ lat: 20.0, lng: 75.0 }, { lat: 20.04, lng: 75.0 }],
  });
  areaSeller = await createTestSeller({ machineCategoryId: catalog.categoryId, industrialAreaId: areaId, point: { lat: 21.2, lng: 72.8 } });
  viewer = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(seller, suspendedSeller, pinned, centroidSeller, areaSeller, viewer);
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { userIds: sellers.map((s) => s.userId) });
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestPincodeOffices(officeIds);
  if (areaId) await db.delete(industrialAreas).where(eq(industrialAreas.id, areaId));
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const listing = (s: TestSeller, kind: ListingKind, status: ListingStatus, extra: { side?: PartSide | null; refreshedAt?: Date; photos?: number; point?: { lat: number; lng: number }; searchPoint?: { lat: number; lng: number } } = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status,
    categoryId: kind === 'part' ? catalog.partGroupId : catalog.machineTypeId,
    ...extra,
  }).then((r) => r.id);

async function visibleIds(ids: string[], kinds: ListingKind[]): Promise<string[]> {
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(sql`${inArray(listings.id, ids)} AND ${discoveryWhere(listings, { kinds })}`);
  return rows.map((r) => r.id).sort();
}

async function expectCode(p: Promise<unknown>, status: number, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === status && e.code === code);
}

describe('discoveryWhere (§R7)', () => {
  it('shows live and reserved, and rented rentals only where rentals are in the kinds', async () => {
    const live = await listing(seller, 'part', 'live');
    const reserved = await listing(seller, 'machine', 'reserved');
    const rented = await listing(seller, 'machine_rental', 'rented');
    const liveRental = await listing(seller, 'machine_rental', 'live');
    const hidden = await Promise.all(
      (['draft', 'paused', 'hidden', 'sold', 'expired', 'pending_review', 'unavailable'] as ListingStatus[]).map((s) => listing(seller, 'part', s)),
    );
    const all = [live, reserved, rented, liveRental, ...hidden];
    expect(await visibleIds(all, [])).toEqual([live, reserved, rented, liveRental].sort());
    expect(await visibleIds(all, ['machine_rental'])).toEqual([live, reserved, rented, liveRental].sort());
    expect(await visibleIds(all, ['part', 'machine_rental'])).toEqual([live, reserved, rented, liveRental].sort());
    // Under Parts or Machines for sale a rented rental never appears (the kind filter itself is the search's job).
    expect(await visibleIds(all, ['part', 'machine'])).toEqual([live, reserved, liveRental].sort());
  });

  it("hides a suspended owner's listings", async () => {
    const id = await listing(suspendedSeller, 'part', 'live');
    expect(await visibleIds([id], [])).toEqual([id]);
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspendedSeller.userId));
    try {
      expect(await visibleIds([id], [])).toEqual([]);
    } finally {
      await db.update(users).set({ status: 'active' }).where(eq(users.id, suspendedSeller.userId));
    }
  });
});

describe('resolveOrigin (§6.3)', () => {
  it('snaps a GPS point and labels it with the nearest office', async () => {
    expect(snapCoord(GPS.lat)).toBe(23.46);
    expect(await resolveOrigin(db, { point: GPS }, null)).toEqual({ point: GPS_SNAPPED, echo: { label: 'Zztpur, Zzt District', source: 'gps' } });
  });

  it('treats a point outside India as out of range: the fallback, else no origin', async () => {
    const london = { lat: 51.5, lng: -0.12 };
    expect(london.lat > INDIA_BOUNDS.maxLat).toBe(true);
    expect(await resolveOrigin(db, { point: london }, null)).toEqual({ point: null, echo: { label: null, source: 'out_of_range' } });
    const viaPincode = await resolveOrigin(db, { point: london, fallback: { pincode: '990022' } }, null);
    expect(viaPincode).toEqual({ point: { lat: 22.01, lng: 79 }, echo: { label: expect.stringMatching(/^Zzt (North|South), Zzt Two$/), source: 'out_of_range' } });
    const viaBusiness = await resolveOrigin(db, { point: london, fallback: { business: true } }, { userId: pinned.userId, businessId: pinned.businessId });
    expect(viaBusiness).toEqual({ point: { lat: 21.18, lng: 72.82 }, echo: { label: 'Test Estate, Surat', source: 'out_of_range' } });
  });

  it("uses a pincode's centroid, and refuses an unknown pincode", async () => {
    expect(await resolveOrigin(db, { pincode: '990022' }, null)).toEqual({
      point: { lat: 22.01, lng: 79 },
      echo: { label: expect.stringMatching(/^Zzt (North|South), Zzt Two$/), source: 'pincode' },
    });
    await expectCode(resolveOrigin(db, { pincode: '990029' }, null), 400, 'PINCODE_UNKNOWN');
    await expectCode(resolveOrigin(db, { pincode: '12ab' }, null), 400, 'PINCODE_UNKNOWN');
  });

  it("uses the business's pin, else its pincode centroid, labelled with its area and city", async () => {
    expect(await resolveOrigin(db, { business: true }, { userId: pinned.userId, businessId: pinned.businessId })).toEqual({
      point: { lat: 21.18, lng: 72.82 },
      echo: { label: 'Test Estate, Surat', source: 'business' },
    });
    expect(await resolveOrigin(db, { business: true }, { userId: centroidSeller.userId, businessId: centroidSeller.businessId })).toEqual({
      point: { lat: 20.02, lng: 75 },
      echo: { label: 'Test Estate, Surat', source: 'business' },
    });
    expect(await resolveOrigin(db, { business: true }, { userId: areaSeller.userId, businessId: areaSeller.businessId })).toEqual({
      point: { lat: 21.2, lng: 72.8 },
      echo: { label: `Zzt Estate ${runId}, Surat`, source: 'business' },
    });
  });

  it('refuses a guest asking for the business location; no business yet is no origin', async () => {
    await expectCode(resolveOrigin(db, { business: true }, null), 401, 'UNAUTHORIZED');
    expect(await resolveOrigin(db, { business: true }, { userId: viewer.userId, businessId: null })).toEqual({
      point: null,
      echo: { label: null, source: null },
    });
    expect(await resolveOrigin(db, null, null)).toEqual({ point: null, echo: { label: null, source: null } });
    expect(await resolveOrigin(db, undefined, null)).toEqual({ point: null, echo: { label: null, source: null } });
  });
});

describe('distance (§6.2)', () => {
  it('never lets the snapped km and the radius filter disagree at the edge', async () => {
    const origin = { lat: 21.17, lng: 72.83 };
    const { rows } = await db.execute<{ d: number; km: number; within: boolean }>(sql`
      SELECT d, ${snappedKmSql(sql`s.p`, origin)} AS km, ${withinRadiusSql(sql`s.p`, origin, 50)} AS within
      FROM (SELECT d, ST_SetSRID(ST_MakePoint(72.83 + d / 3, 21.17 + d), 4326)::geography AS p
            FROM generate_series(0.380::numeric, 0.520::numeric, 0.001::numeric) d) s`);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.some((r) => r.within) && rows.some((r) => !r.within)).toBe(true);
    for (const r of rows) expect(r.within, `d=${r.d} km=${r.km}`).toBe(Number(r.km) <= 50);
  });

  it('never drops a snapped match from an off-grid origin, in any direction', async () => {
    // An origin ~0.005° off the grid: snapping moves both points up to ~0.78 km, so the raw-distance prefilter needs
    // its 3 km margin.
    const origin = { lat: 21.17499, lng: 72.83499 };
    for (const radius of [10, 50]) {
      const { rows } = await db.execute<{ km: number | null; within: boolean }>(sql`
        SELECT ${snappedKmSql(sql`s.p`, origin)} AS km, ${withinRadiusSql(sql`s.p`, origin, radius)} AS within
        FROM (
          SELECT ST_Project(${pointSql(origin)}, (${radius}::float8 - 3 + k * 0.05) * 1000, radians(bearing)) AS p
          FROM generate_series(0, 120) k, generate_series(0, 345, 15) bearing
        ) s`);
      expect(rows.length).toBe(121 * 24);
      let matches = 0;
      for (const r of rows) {
        const km = Number(r.km);
        if (km <= radius) matches++;
        expect(r.within, `r=${radius} km=${km}`).toBe(km <= radius);
      }
      expect(matches).toBeGreaterThan(0);
      expect(matches).toBeLessThan(rows.length);
    }
  });

  it('gives at least 1 km, and null for no point', async () => {
    const origin = { lat: 21.17, lng: 72.83 };
    const { rows } = await db.execute<{ same: number; none: number | null }>(sql`
      SELECT ${snappedKmSql(pointSql(origin), origin)} AS same, ${snappedKmSql(sql`NULL::geography`, origin)} AS none`);
    expect(Number(rows[0]!.same)).toBe(1);
    expect(rows[0]!.none).toBeNull();
  });
});

describe('ranking (§5.5, §6.1)', () => {
  it('puts the exact side and available rentals in the higher tier', async () => {
    const left = await listing(seller, 'part', 'live', { side: 'left' });
    const pair = await listing(seller, 'part', 'live', { side: 'pair' });
    const rented = await listing(seller, 'machine_rental', 'rented');
    const free = await listing(seller, 'machine_rental', 'live');
    const tiers = async (side: 'left' | 'right' | 'pair' | null) => {
      const rows = await db
        .select({ id: listings.id, tier: sql<number>`${tierSql({ side })}` })
        .from(listings)
        .where(inArray(listings.id, [left, pair, rented, free]));
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.tier)]));
    };
    expect(await tiers('left')).toMatchObject({ [left]: 3, [pair]: 1 });
    expect(await tiers('pair')).toMatchObject({ [pair]: 3 });
    expect(await tiers(null)).toEqual({ [left]: 3, [pair]: 3, [rented]: 2, [free]: 3 });
  });

  it('ages relevance from asOf, not from now, and ranks reserved down', async () => {
    const refreshedAt = new Date('2026-01-01T00:00:00.000Z');
    const live = await listing(seller, 'part', 'live', { refreshedAt, photos: 0 });
    const reserved = await listing(seller, 'part', 'reserved', { refreshedAt, photos: 0 });
    const score = async (id: string, asOf: Date) => {
      const [row] = await db
        .select({ r: sql<number>`${relevanceSql({ asOf, origin: null, radiusKm: null })}` })
        .from(listings)
        .where(eq(listings.id, id));
      return Number(row!.r);
    };
    const fresh = await score(live, refreshedAt);
    const twoWeeks = await score(live, new Date(refreshedAt.getTime() + 14 * 86_400_000));
    expect(fresh - twoWeeks).toBeCloseTo(0.2, 6);
    expect(await score(reserved, refreshedAt)).toBeCloseTo(fresh * 0.6, 6);
  });

  it('adds nearness within the radius', async () => {
    const at = new Date('2026-02-01T00:00:00.000Z');
    const near = await listing(seller, 'part', 'live', { refreshedAt: at, photos: 0, searchPoint: { lat: 21.17, lng: 72.83 } });
    // Only `search_point` counts (§6.2): a listing with just a `point` has no nearness.
    const pointOnly = await listing(seller, 'part', 'live', { refreshedAt: at, photos: 0, point: { lat: 21.17, lng: 72.83 } });
    const [row] = await db
      .select({
        withOrigin: sql<number>`${relevanceSql({ asOf: at, origin: { lat: 21.17, lng: 72.83 }, radiusKm: 50 })}`,
        without: sql<number>`${relevanceSql({ asOf: at, origin: null, radiusKm: 50 })}`,
      })
      .from(listings)
      .where(eq(listings.id, near));
    // 1 km away under a 50 km radius: nearness 0.98, weighted 0.30.
    expect(Number(row!.withOrigin) - Number(row!.without)).toBeCloseTo(0.3 * (1 - 1 / 50), 6);
    const [other] = await db
      .select({
        withOrigin: sql<number>`${relevanceSql({ asOf: at, origin: { lat: 21.17, lng: 72.83 }, radiusKm: 50 })}`,
        without: sql<number>`${relevanceSql({ asOf: at, origin: null, radiusKm: 50 })}`,
      })
      .from(listings)
      .where(eq(listings.id, pointOnly));
    expect(Number(other!.withOrigin)).toBeCloseTo(Number(other!.without), 9);
  });
});

describe('cursor (§5.10)', () => {
  const payload = { asOf: '2026-11-19T10:00:00.000Z', tier: 3, key: 12345.5, key2: null, id: randomUUID() };
  const req = { q: 'bearing', filters: { kinds: ['part'] }, sort: 'best_match', origin: { pincode: '395002' } };

  it('round-trips a sealed payload under the same AAD', () => {
    const aad = cursorAad('best_match', requestHash(req));
    const token = sealCursor(payload, aad);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(payload.id);
    expect(openCursor(token, aad)).toEqual(payload);
  });

  it('refuses a tampered token, another AAD and garbage', () => {
    const aad = cursorAad('best_match', requestHash(req));
    const token = sealCursor(payload, aad);
    const flip = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21);
    const invalid = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof AppError && e.statusCode === 400 && e.code === 'CURSOR_INVALID';
      }
      return false;
    };
    expect(invalid(() => openCursor(flip, aad))).toBe(true);
    expect(invalid(() => openCursor(token, cursorAad('newest', requestHash(req))))).toBe(true);
    expect(invalid(() => openCursor(token, cursorAad('best_match', requestHash({ ...req, q: 'bearings' }))))).toBe(true);
    expect(invalid(() => openCursor('not-a-cursor', aad))).toBe(true);
    expect(invalid(() => openCursor('', aad))).toBe(true);
  });

  it('hashes the request canonically, without the cursor, with the origin', () => {
    const permuted = { origin: { pincode: '395002' }, sort: 'best_match', filters: { kinds: ['part'] }, q: 'bearing', cursor: 'abc' };
    expect(requestHash(permuted)).toBe(requestHash(req));
    expect(requestHash({ ...req, origin: { pincode: '395003' } })).not.toBe(requestHash(req));
    expect(requestHash(req)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('reader version key (§5.3)', () => {
  it('bumps and reads under the test prefix only', async () => {
    const redis = app.redis!;
    const key = readerVersionKey();
    expect(key).toBe(`${process.env.DISCOVERY_REDIS_PREFIX}discovery:reader:version`);
    expect(key.startsWith('test:')).toBe(true);
    const unprefixed = await redis.get('discovery:reader:version');
    expect(await readReaderVersion(redis)).toBe(0);
    expect(await bumpReaderVersion(redis)).toBe(1);
    expect(await bumpReaderVersion(redis)).toBe(2);
    expect(await readReaderVersion(redis)).toBe(2);
    expect(await redis.get('discovery:reader:version')).toBe(unprefixed);
    await redis.del(key);
    expect(await readReaderVersion(undefined)).toBe(0);
  });
});

describe('rate limits (R17, §7)', () => {
  const fake = (headers: Record<string, string>, ip = '10.1.2.3') => ({ headers, ip }) as Parameters<typeof discoveryRateKey>[0];

  it('keys by user, else install id, else IP', () => {
    const userId = randomUUID();
    const install = randomUUID();
    expect(discoveryRateKey(fake({ authorization: `Bearer ${signUserToken({ userId, businessId: null })}` }))).toBe(`u:${userId}`);
    expect(discoveryRateKey(fake({ authorization: `Bearer ${signUserToken({ userId, businessId: null })}`, 'x-install-id': install }))).toBe(`u:${userId}`);
    expect(discoveryRateKey(fake({ 'x-install-id': install }))).toBe(`i:${install.toLowerCase()}`);
    expect(discoveryRateKey(fake({ 'x-install-id': 'not-a-uuid' }))).toBe('ip:10.1.2.3');
    expect(discoveryRateKey(fake({ authorization: 'Bearer junk' }))).toBe('ip:10.1.2.3');
    expect(discoveryRateKey(fake({ authorization: `Bearer ${signAdminToken({ adminId: randomUUID(), role: 'super_admin' })}` }))).toBe('ip:10.1.2.3');
  });

  it('has the spec numbers unless overridden', () => {
    expect(discoveryRateLimits({})).toEqual({
      search: DISCOVERY_LIMITS.rateLimitSearch,
      count: DISCOVERY_LIMITS.rateLimitCount,
      suggest: DISCOVERY_LIMITS.rateLimitSuggest,
      other: DISCOVERY_LIMITS.rateLimitOther,
      ipOuter: DISCOVERY_LIMITS.rateLimitIpOuter,
    });
    expect(discoveryRateLimits({ DISCOVERY_RATE_LIMIT_MAX: '5', DISCOVERY_IP_RATE_MAX: '9' })).toEqual({
      search: 5, count: 5, suggest: 5, other: 5, ipOuter: 9,
    });
    expect(() => discoveryRateLimits({ DISCOVERY_RATE_LIMIT_MAX: 'x' })).toThrow();
  });

  const ROUTES: Array<{ method: 'GET' | 'POST'; url: string }> = [
    { method: 'POST', url: '/discover/search' },
    { method: 'POST', url: '/discover/search/count' },
    { method: 'GET', url: '/discover/suggest?q=be' },
    { method: 'GET', url: '/discover/trending' },
    { method: 'POST', url: '/discover/home' },
    { method: 'POST', url: '/discover/browse' },
    { method: 'POST', url: '/discover/browse/brand' },
    { method: 'POST', url: '/discover/cards' },
  ];
  let ipSeq = 0;
  const freshIp = () => `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const hit = (route: { method: 'GET' | 'POST'; url: string }, install: string, remoteAddress: string) =>
    app.inject({ method: route.method, url: route.url, remoteAddress, headers: { 'x-install-id': install }, payload: route.method === 'POST' ? {} : undefined });

  it('answers 429 on every /discover route past its limit (stubs answer 501 until then)', async () => {
    for (const route of ROUTES) {
      const install = randomUUID();
      const ip = freshIp();
      for (let i = 0; i < 3; i++) {
        const res = await hit(route, install, ip);
        expect(res.statusCode, `${route.url} #${i + 1}`).toBe(501);
        expect(res.json().code).toBe('NOT_IMPLEMENTED');
      }
      const over = await hit(route, install, ip);
      expect(over.statusCode, route.url).toBe(429);
      expect(over.json().code).toBe('RATE_LIMITED');
    }
  });

  it('gives count-only its own bucket, apart from search', async () => {
    const install = randomUUID();
    const ip = freshIp();
    const search = ROUTES[0]!;
    const count = ROUTES[1]!;
    for (let i = 0; i < 3; i++) expect((await hit(search, install, ip)).statusCode).toBe(501);
    expect((await hit(search, install, ip)).statusCode).toBe(429);
    for (let i = 0; i < 3; i++) expect((await hit(count, install, ip)).statusCode).toBe(501);
    expect((await hit(count, install, ip)).statusCode).toBe(429);

    const other = randomUUID();
    const ip2 = freshIp();
    for (let i = 0; i < 3; i++) expect((await hit(count, other, ip2)).statusCode).toBe(501);
    expect((await hit(count, other, ip2)).statusCode).toBe(429);
    expect((await hit(search, other, ip2)).statusCode).toBe(501);
  });

  it('caps one IP across every /discover route, whatever the install id', async () => {
    const ip = freshIp();
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const res = await hit(ROUTES[i % ROUTES.length]!, randomUUID(), ip);
      if (res.statusCode === 501) ok++;
    }
    expect(ok).toBe(10);
    const capped = await hit(ROUTES[3]!, randomUUID(), ip);
    expect(capped.statusCode).toBe(429);
    expect(capped.json().code).toBe('RATE_LIMITED');
    const retryAfter = Number(capped.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const retryAt = Date.parse(capped.json().details.retryAt);
    expect(retryAt).toBeGreaterThan(Date.now());
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 60_000);
    // Another IP is unaffected.
    expect((await hit(ROUTES[3]!, randomUUID(), freshIp())).statusCode).toBe(501);
  });

  it('answers 501 on the saved and admin search stubs behind their auth', async () => {
    const id = randomUUID();
    expect((await app.inject({ method: 'GET', url: '/users/me/saved-listings' })).statusCode).toBe(401);
    const auth = { authorization: `Bearer ${viewer.token}` };
    expect((await app.inject({ method: 'GET', url: '/users/me/saved-listings', headers: auth })).statusCode).toBe(501);
    expect((await app.inject({ method: 'PUT', url: `/users/me/saved-listings/${id}`, headers: auth })).statusCode).toBe(501);
    expect((await app.inject({ method: 'DELETE', url: `/users/me/saved-listings/${id}`, headers: auth })).statusCode).toBe(501);
    expect((await app.inject({ method: 'GET', url: '/admin/search/synonyms' })).statusCode).toBe(401);
    const admin = { authorization: `Bearer ${signAdminToken({ adminId: randomUUID(), role: 'category_manager' })}` };
    const support = { authorization: `Bearer ${signAdminToken({ adminId: randomUUID(), role: 'support' })}` };
    expect((await app.inject({ method: 'GET', url: '/admin/search/synonyms', headers: support })).statusCode).toBe(403);
    for (const [method, url] of [
      ['GET', '/admin/search/synonyms'],
      ['POST', '/admin/search/synonyms'],
      ['PATCH', `/admin/search/synonyms/${id}`],
      ['DELETE', `/admin/search/synonyms/${id}`],
      ['POST', '/admin/search/synonyms/preview'],
      ['GET', '/admin/search/zero-results'],
      ['GET', '/admin/search/trending'],
      ['PUT', '/admin/search/trending-hidden/abc'],
      ['DELETE', '/admin/search/trending-hidden/abc'],
    ] as const) {
      expect((await app.inject({ method, url, headers: admin })).statusCode, `${method} ${url}`).toBe(501);
    }
  });
});

describe('loadCards (§7)', () => {
  it("sets saved for a viewer, tags for the side filter and status, and the distance from an origin", async () => {
    const pairId = await listing(seller, 'part', 'live', { side: 'pair', searchPoint: { lat: 21.17, lng: 72.83 } });
    const leftId = await listing(seller, 'part', 'reserved', { side: 'left' });
    const rentedId = await listing(seller, 'machine_rental', 'rented');
    await db.insert(savedListings).values({ userId: viewer.userId, listingId: pairId });
    const rows = await db.select().from(listings).where(inArray(listings.id, [pairId, leftId, rentedId]));
    const ordered = [pairId, leftId, rentedId].map((id) => rows.find((r) => r.id === id)!);

    const guest = await loadCards(db, ordered);
    expect(guest.map((c) => [c.saved, c.tags])).toEqual([
      [null, []],
      [null, ['reserved']],
      [null, ['on_rent']],
    ]);

    const signedIn = await loadCards(db, ordered, { viewerUserId: viewer.userId, side: 'left', origin: { lat: 21.27, lng: 72.83 } });
    expect(signedIn.map((c) => c.id)).toEqual([pairId, leftId, rentedId]);
    expect(signedIn.map((c) => c.saved)).toEqual([true, false, false]);
    expect(signedIn[0]!.tags).toEqual(['pair_contains_left']);
    expect(signedIn[1]!.tags).toEqual(['reserved']);
    // 0.10° of latitude ≈ 11.1 km, snapped and floored; no `search_point`, no distance (§6.2).
    expect(signedIn[0]!.distanceKm).toBe(11);
    expect(signedIn[1]!.distanceKm).toBeNull();

    const right = await loadCards(db, ordered, { side: 'right' });
    expect(right[0]!.tags).toEqual(['pair_contains_right']);
  });
});
