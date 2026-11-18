import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { inArray, sql } from 'drizzle-orm';
import type { IndustrialArea, PincodeInfo } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { industrialAreas, pincodeOffices } from '../src/db/schema.js';
import { pincodeDistrict } from '../src/services/locations/pincode.service.js';

// Public location API (F1 spec §4.2, §4.4, §10). The suite inserts its own post offices under test pincodes
// 990001–990004 (no real office uses them), far out in the Arabian Sea so the real directory, when loaded, is never
// within 50 km. 990009 is never inserted: the unknown pincode.

const S = `${Date.now()}`;
const PIN_SURAT = '990001';
const PIN_MAJORITY = '990002';
const PIN_TIE = '990003';
const PIN_NEAR = '990004';
const PIN_UNKNOWN = '990009';
const OUR_PINS = [PIN_SURAT, PIN_MAJORITY, PIN_TIE, PIN_NEAR];

const STATE = `Testland ${S}`;
// Alphabetically last, but it has more offices in PIN_MAJORITY.
const DISTRICT_A = `ZED MAJOR ${S}`;
const CITY_A = `Zed Major ${S}`;
// Alphabetically first: wins the 1–1 tie in PIN_TIE.
const DISTRICT_B = `AAA MINOR ${S}`;
const CITY_B = `Aaa Minor ${S}`;

const areaIds: string[] = [];

async function office(pincode: string, officeName: string, district: string, state: string, point?: { lat: number; lng: number }) {
  await db.insert(pincodeOffices).values({
    pincode,
    officeName,
    district,
    state,
    point: point ? sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography` : null,
  });
}

async function area(name: string, city: string, state: string, opts: { isActive?: boolean; sortOrder?: number } = {}) {
  const [row] = await db
    .insert(industrialAreas)
    .values({ name, city, state, isActive: opts.isActive ?? true, sortOrder: opts.sortOrder ?? 0 })
    .returning({ id: industrialAreas.id });
  areaIds.push(row!.id);
  return row!.id;
}

describe('public location API', () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    // Leftovers of an interrupted run: these pincodes belong to the tests alone.
    await db.delete(pincodeOffices).where(inArray(pincodeOffices.pincode, OUR_PINS));

    await office(PIN_SURAT, 'Pandesara', 'SURAT', 'Gujarat', { lat: 15.0, lng: 64.0 });
    await office(PIN_SURAT, 'Bhestan', 'SURAT', 'Gujarat', { lat: 15.001, lng: 64.0 });
    await office(PIN_NEAR, 'Near Office', 'SURAT', 'Gujarat', { lat: 15.2, lng: 64.0 });

    await office(PIN_MAJORITY, 'Office One', DISTRICT_A, STATE);
    await office(PIN_MAJORITY, 'Office Two', DISTRICT_A, STATE);
    await office(PIN_MAJORITY, 'Office Three', DISTRICT_B, STATE);

    await office(PIN_TIE, 'Tie One', DISTRICT_A, STATE);
    await office(PIN_TIE, 'Tie Two', DISTRICT_B, STATE);

    ids.a1 = await area(`Estate One ${S}`, CITY_A, STATE, { sortOrder: 20 });
    // City in another case: matched case-insensitively.
    ids.a2 = await area(`Estate Two ${S}`, CITY_A.toUpperCase(), STATE, { sortOrder: 10 });
    ids.aInactive = await area(`Estate Closed ${S}`, CITY_A, STATE, { isActive: false });
    ids.b1 = await area(`Estate Bee ${S}`, CITY_B, STATE);
    // Same city name, other state: never matched.
    ids.otherState = await area(`Estate Elsewhere ${S}`, CITY_A, `Otherland ${S}`);
  });

  afterAll(async () => {
    await db.delete(pincodeOffices).where(inArray(pincodeOffices.pincode, OUR_PINS));
    if (areaIds.length) await db.delete(industrialAreas).where(inArray(industrialAreas.id, areaIds));
    await app?.close();
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  describe('GET /locations/pincodes/:pincode', () => {
    it('returns the district, the title-cased city, the state and the sorted office names', async () => {
      const res = await get(`/locations/pincodes/${PIN_SURAT}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data as PincodeInfo).toEqual({
        pincode: PIN_SURAT,
        district: 'SURAT',
        city: 'Surat',
        state: 'Gujarat',
        offices: ['Bhestan', 'Pandesara'],
      });
    });

    it('404s an unknown pincode', async () => {
      const res = await get(`/locations/pincodes/${PIN_UNKNOWN}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it.each(['012345', '12345', '39422A'])('400s the malformed pincode %s', async (pincode) => {
      const res = await get(`/locations/pincodes/${pincode}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('resolves a pincode with two offices in district A and one in B to A, even when B sorts first', async () => {
      const res = await get(`/locations/pincodes/${PIN_MAJORITY}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ district: DISTRICT_A, city: CITY_A, state: STATE });
      expect(res.json().data.offices).toEqual(['Office One', 'Office Three', 'Office Two']);
    });

    it('resolves a 1–1 tie to the alphabetically first district', async () => {
      const res = await get(`/locations/pincodes/${PIN_TIE}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ district: DISTRICT_B, city: CITY_B, state: STATE });
    });
  });

  describe('pincodeDistrict', () => {
    it('is the one rule: majority district, ties alphabetical, city title-cased; null when unknown', async () => {
      expect(await pincodeDistrict(db, PIN_MAJORITY)).toEqual({ district: DISTRICT_A, state: STATE, city: CITY_A });
      expect(await pincodeDistrict(db, PIN_TIE)).toEqual({ district: DISTRICT_B, state: STATE, city: CITY_B });
      expect(await pincodeDistrict(db, PIN_UNKNOWN)).toBeNull();
    });
  });

  describe('GET /locations/nearest-pincode', () => {
    it('returns the pincode of the closest office within 50 km', async () => {
      const nearNear = await get('/locations/nearest-pincode?lat=15.15&lng=64');
      expect(nearNear.statusCode, nearNear.body).toBe(200);
      expect(nearNear.json().data).toMatchObject({ pincode: PIN_NEAR, city: 'Surat', state: 'Gujarat' });

      const nearSurat = await get('/locations/nearest-pincode?lat=15.02&lng=64');
      expect(nearSurat.statusCode, nearSurat.body).toBe(200);
      expect(nearSurat.json().data).toMatchObject({ pincode: PIN_SURAT, offices: ['Bhestan', 'Pandesara'] });
    });

    it('404s when no office is within 50 km', async () => {
      // About 107 km west of the nearest test office, and further still from India.
      const res = await get('/locations/nearest-pincode?lat=15&lng=63');
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it.each([
      ['lat=91&lng=64'],
      ['lat=15&lng=181'],
      ['lat=15'],
      ['lat=abc&lng=64'],
    ])('400s %s', async (query) => {
      const res = await get(`/locations/nearest-pincode?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /locations/industrial-areas?pincode=', () => {
    it("lists only the active areas of the pincode's district and state, by sort order", async () => {
      const res = await get(`/locations/industrial-areas?pincode=${PIN_MAJORITY}`);
      expect(res.statusCode, res.body).toBe(200);
      const areas = res.json().data as IndustrialArea[];
      expect(areas.map((a) => a.id)).toEqual([ids.a2, ids.a1]);
      expect(areas[1]).toEqual({ id: ids.a1, name: `Estate One ${S}`, city: CITY_A, state: STATE, isActive: true, sortOrder: 20 });
    });

    it('follows the same district rule as the lookup: a 1–1 tie lists district B', async () => {
      const res = await get(`/locations/industrial-areas?pincode=${PIN_TIE}`);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().data as IndustrialArea[]).map((a) => a.id)).toEqual([ids.b1]);
    });

    it('returns [] for an unknown pincode', async () => {
      const res = await get(`/locations/industrial-areas?pincode=${PIN_UNKNOWN}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toEqual([]);
    });

    it('400s a missing or malformed pincode', async () => {
      expect((await get('/locations/industrial-areas')).statusCode).toBe(400);
      expect((await get('/locations/industrial-areas?pincode=012345')).statusCode).toBe(400);
    });
  });
});
