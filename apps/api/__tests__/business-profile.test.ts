import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import type { BusinessProfile, GstDetails } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  businessVerifications, businesses, categories, gstChecks, gstRepresentativeProofs, industrialAreas, pincodeOffices, users,
} from '../src/db/schema.js';
import { signUserToken } from '../src/plugins/auth.js';
import { signInWithPhone } from '../src/services/user.service.js';
import { createTestBusinessUser, deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';

// Business profile, location and the onboarding step (F1 spec §4, §10; ruling R1: a new user has no business until
// the first PATCH /businesses/me). Test pincodes 990007–990008 are inserted here (no real office uses them);
// 990009 is never inserted: the unknown pincode.

const S = `${Date.now()}`;
const PIN_HERE = '990007';
const PIN_THERE = '990008';
const PIN_UNKNOWN = '990009';
const OUR_PINS = [PIN_HERE, PIN_THERE];
const STATE = `Profileland ${S}`;
const DISTRICT_HERE = `PROFILE DIST ${S}`;
const CITY_HERE = `Profile Dist ${S}`;
const DISTRICT_THERE = `OTHER DIST ${S}`;
const CITY_THERE = `Other Dist ${S}`;

describe('business profile API', () => {
  let app: FastifyInstance;
  let catalog: TestCatalog;
  let inactiveCatalog: TestCatalog;
  const businessIds: string[] = [];
  const userIds: string[] = [];
  const area: Record<string, string> = {};

  // The user onboarded step by step through the API.
  let token = '';
  let phone = '';
  let userId = '';

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    catalog = await createTestCatalog();
    inactiveCatalog = await createTestCatalog();
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, inactiveCatalog.categoryId));

    await db.delete(pincodeOffices).where(inArray(pincodeOffices.pincode, OUR_PINS));
    await db.insert(pincodeOffices).values([
      { pincode: PIN_HERE, officeName: 'Here', district: DISTRICT_HERE, state: STATE },
      { pincode: PIN_THERE, officeName: 'There', district: DISTRICT_THERE, state: STATE },
    ]);
    const rows = await db
      .insert(industrialAreas)
      .values([
        { name: `Here Estate ${S}`, city: CITY_HERE, state: STATE, sortOrder: 10 },
        { name: `Closed Estate ${S}`, city: CITY_HERE, state: STATE, sortOrder: 20, isActive: false },
        { name: `There Estate ${S}`, city: CITY_THERE, state: STATE, sortOrder: 10 },
      ])
      .returning({ id: industrialAreas.id, name: industrialAreas.name });
    area.here = rows.find((r) => r.name.startsWith('Here'))!.id;
    area.closed = rows.find((r) => r.name.startsWith('Closed'))!.id;
    area.there = rows.find((r) => r.name.startsWith('There'))!.id;

    phone = uniqueTestPhone();
    const signIn = await signInWithPhone(db, phone);
    userId = signIn.user.id;
    userIds.push(userId);
    token = signIn.token;
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool. Businesses reference areas: delete them first.
    const owned = await db.select({ businessId: users.businessId }).from(users).where(inArray(users.id, userIds));
    const all = [...businessIds, ...owned.map((r) => r.businessId).filter((id): id is string => !!id)];
    await deleteTestBusinesses([...new Set(all)]);
    await deleteTestUsers(userIds);
    await db.delete(industrialAreas).where(eq(industrialAreas.state, STATE));
    await db.delete(pincodeOffices).where(inArray(pincodeOffices.pincode, OUR_PINS));
    if (catalog) await deleteTestCatalog(catalog.categoryId);
    if (inactiveCatalog) await deleteTestCatalog(inactiveCatalog.categoryId);
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, bearer = token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, payload: body as InjectOptions['payload'] });
  }

  async function me(bearer = token): Promise<BusinessProfile> {
    const res = await call('GET', '/businesses/me', undefined, bearer);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as BusinessProfile;
  }

  const location = (extra: Record<string, unknown> = {}) => ({
    pincode: PIN_HERE,
    city: CITY_HERE,
    state: STATE,
    industrialAreaId: area.here,
    ...extra,
  });

  describe('a new user (no business yet)', () => {
    it("signs in with onboarding 'profile'", async () => {
      const again = await signInWithPhone(db, phone);
      expect(again).toMatchObject({ isNewUser: true, onboarding: 'profile' });
    });

    it('GET /businesses/me and PUT location are 404 NO_BUSINESS', async () => {
      const get = await call('GET', '/businesses/me');
      expect(get.statusCode, get.body).toBe(404);
      expect(get.json().code).toBe('NO_BUSINESS');
      const put = await call('PUT', '/businesses/me/location', location());
      expect(put.statusCode, put.body).toBe(404);
      expect(put.json().code).toBe('NO_BUSINESS');
    });

    it('the first PATCH without businessName is 400 VALIDATION_ERROR and creates nothing', async () => {
      const res = await call('PATCH', '/businesses/me', { name: 'Ravi Patel', activities: ['buy'], categories: [catalog.categoryId] });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user!.businessId).toBeNull();
    });

    it('the first PATCH without activities is 400 VALIDATION_ERROR', async () => {
      const res = await call('PATCH', '/businesses/me', { name: 'Ravi Patel', businessName: `Ravi Works ${S}` });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it("the first PATCH creates the business with its activities and categories: onboarding 'location'", async () => {
      const res = await call('PATCH', '/businesses/me', {
        name: 'Ravi Patel',
        businessName: `Ravi Works ${S}`,
        activities: ['buy', 'sell', 'buy'],
        categories: [catalog.categoryId],
      });
      expect(res.statusCode, res.body).toBe(200);
      const profile = res.json().data as BusinessProfile;
      expect(profile).toMatchObject({
        tradeName: `Ravi Works ${S}`,
        displayName: `Ravi Works ${S}`,
        nameLocked: false,
        activities: ['buy', 'sell'],
        categories: [catalog.categoryId],
        onboarding: 'location',
        completion: { name: true, activities: true, location: false, gst: false },
      });
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user).toMatchObject({ name: 'Ravi Patel', businessId: profile.id });
      expect(await signInWithPhone(db, phone)).toMatchObject({ isNewUser: false, onboarding: 'location' });
      // The sign-in token still says businessId null: the API finds the business through the user.
      expect((await me()).id).toBe(profile.id);
    });
  });

  describe('PATCH /businesses/me', () => {
    it('refuses empty activities and unknown ones', async () => {
      expect((await call('PATCH', '/businesses/me', { activities: [] })).statusCode).toBe(400);
      expect((await call('PATCH', '/businesses/me', { activities: ['lease'] })).statusCode).toBe(400);
    });

    it.each([
      ['an inactive machine category', () => inactiveCatalog.categoryId],
      ['a machine type (not level 1)', () => catalog.machineTypeId],
      ['an unknown id', () => '00000000-0000-4000-8000-000000000000'],
    ])('refuses %s: 400 INVALID_CATEGORY', async (_what, id) => {
      const res = await call('PATCH', '/businesses/me', { categories: [catalog.categoryId, id()] });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('INVALID_CATEGORY');
    });

    it('refuses a year before 1900 or after this year', async () => {
      expect((await call('PATCH', '/businesses/me', { yearEstablished: 1899 })).statusCode).toBe(400);
      expect((await call('PATCH', '/businesses/me', { yearEstablished: new Date().getFullYear() + 1 })).statusCode).toBe(400);
    });

    it('saves the optional fields and clears them with null', async () => {
      const saved = await call('PATCH', '/businesses/me', { email: 'ravi@example.test', yearEstablished: 1998, employees: '11-50' });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().data).toMatchObject({ email: 'ravi@example.test', yearEstablished: 1998, employees: '11-50' });
      const cleared = await call('PATCH', '/businesses/me', { email: null, yearEstablished: null, employees: null });
      expect(cleared.json().data).toMatchObject({ email: null, yearEstablished: null, employees: null });
      expect((await call('PATCH', '/businesses/me', { email: 'not-an-email' })).statusCode).toBe(400);
    });

    it('drops category ids that were deactivated since, at read', async () => {
      const [business] = await db.select({ id: businesses.id }).from(businesses).innerJoin(users, eq(users.businessId, businesses.id)).where(eq(users.id, userId));
      await db.update(businesses).set({ categories: [catalog.categoryId, inactiveCatalog.categoryId] }).where(eq(businesses.id, business!.id));
      expect((await me()).categories).toEqual([catalog.categoryId]);
    });
  });

  describe('PUT /businesses/me/location', () => {
    it.each([
      ['both an area and Other', { industrialAreaOther: 'Kosad Estate' }],
      ['neither an area nor Other', { industrialAreaId: undefined }],
      ['lat without lng', { lat: 21.17 }],
      ['a malformed pincode', { pincode: '012345' }],
    ])('refuses %s: 400 VALIDATION_ERROR', async (_what, extra) => {
      const res = await call('PUT', '/businesses/me/location', location(extra));
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it("refuses an area of another district, or an inactive one: 400 AREA_MISMATCH", async () => {
      for (const id of [area.there, area.closed]) {
        const res = await call('PUT', '/businesses/me/location', location({ industrialAreaId: id }));
        expect(res.statusCode, res.body).toBe(400);
        expect(res.json().code).toBe('AREA_MISMATCH');
      }
    });

    it("saves the location: onboarding 'done', completion.location true", async () => {
      const res = await call('PUT', '/businesses/me/location', location({ city: 'Profile City', addressLine: 'Plot 12, Road 3', lat: 21.17, lng: 72.83 }));
      expect(res.statusCode, res.body).toBe(200);
      const profile = res.json().data as BusinessProfile;
      expect(profile.onboarding).toBe('done');
      expect(profile.completion).toEqual({ name: true, activities: true, location: true, gst: false });
      expect(profile.location).toEqual({
        pincode: PIN_HERE,
        city: 'Profile City',
        state: STATE,
        industrialAreaId: area.here,
        industrialAreaName: `Here Estate ${S}`,
        industrialAreaOther: null,
        addressLine: 'Plot 12, Road 3',
        lat: 21.17,
        lng: 72.83,
      });
      expect(await signInWithPhone(db, phone)).toMatchObject({ onboarding: 'done' });
    });

    it('keeps a deactivated area the business already has when it saves again', async () => {
      await db.update(industrialAreas).set({ isActive: false }).where(eq(industrialAreas.id, area.here));
      try {
        const res = await call('PUT', '/businesses/me/location', location());
        expect(res.statusCode, res.body).toBe(200);
        expect((res.json().data as BusinessProfile).location).toMatchObject({ industrialAreaId: area.here, lat: null, lng: null });
      } finally {
        await db.update(industrialAreas).set({ isActive: true }).where(eq(industrialAreas.id, area.here));
      }
    });

    it('accepts an unknown pincode with Other, as typed', async () => {
      const res = await call('PUT', '/businesses/me/location', {
        pincode: PIN_UNKNOWN, city: 'Newtown', state: 'Gujarat', industrialAreaOther: '  Kosad Estate ',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().data as BusinessProfile).location).toMatchObject({
        pincode: PIN_UNKNOWN, city: 'Newtown', state: 'Gujarat', industrialAreaId: null, industrialAreaName: null,
        industrialAreaOther: 'Kosad Estate',
      });
    });

    it('refuses an area for an unknown pincode: 400 AREA_MISMATCH', async () => {
      const res = await call('PUT', '/businesses/me/location', location({ pincode: PIN_UNKNOWN }));
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('AREA_MISMATCH');
    });
  });

  describe('GST-verified name', () => {
    async function verifyGst(businessId: string, ownerId: string, details: Partial<GstDetails>) {
      const full: GstDetails = {
        legalName: 'Legal Name Private Limited',
        tradeName: null,
        address: { line: '1 Ring Road', city: 'Surat', state: 'Gujarat', pincode: '395002' },
        constitution: 'private_limited',
        natureOfBusiness: null,
        registeredOn: '2015-04-01',
        status: 'active',
        ...details,
      };
      const gstin = '24AAACC0000C1ZY';
      await db.update(businesses).set({ legalName: full.legalName }).where(eq(businesses.id, businessId));
      const [check] = await db
        .insert(gstChecks)
        .values({ businessId, userId: ownerId, gstin, source: 'business', result: 'found', gstStatus: 'active', details: full, resolvedAt: new Date() })
        .returning({ id: gstChecks.id });
      const [proof] = await db
        .insert(gstRepresentativeProofs)
        .values({ checkId: check!.id, businessId, userId: ownerId, gstin, declarationVersion: 1, method: 'provider_otp', status: 'passed' })
        .returning({ id: gstRepresentativeProofs.id });
      await db.insert(businessVerifications).values({
        businessId, level: 'gst', method: 'provider_otp', reason: 'test', verifiedByProofId: proof!.id,
      });
    }

    it("locks the business name (409 NAME_LOCKED) and shows GST's trade name", async () => {
      const owner = await createTestBusinessUser({ activities: ['sell'] });
      businessIds.push(owner.businessId);
      await verifyGst(owner.businessId, owner.userId, { tradeName: `GST Trade Name ${S}` });

      const profile = await me(owner.token);
      expect(profile).toMatchObject({ displayName: `GST Trade Name ${S}`, nameLocked: true, completion: { gst: true } });

      const res = await call('PATCH', '/businesses/me', { businessName: 'Something Else' }, owner.token);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe('NAME_LOCKED');

      // Other fields still save.
      const other = await call('PATCH', '/businesses/me', { activities: ['sell', 'rent_out'] }, owner.token);
      expect(other.statusCode, other.body).toBe(200);
      expect(other.json().data.activities).toEqual(['sell', 'rent_out']);
    });

    it('shows the legal name when the GST registration has no trade name', async () => {
      const owner = await createTestBusinessUser();
      businessIds.push(owner.businessId);
      await verifyGst(owner.businessId, owner.userId, { tradeName: null, legalName: `Legal Only ${S} Pvt Ltd` });
      expect(await me(owner.token)).toMatchObject({ displayName: `Legal Only ${S} Pvt Ltd`, nameLocked: true });
    });
  });

  it('a token for a deleted user is 404, not a 500', async () => {
    const ghost = signUserToken({ userId: '00000000-0000-4000-8000-000000000000', businessId: null });
    const res = await call('GET', '/businesses/me', undefined, ghost);
    expect(res.statusCode).toBe(404);
  });
});
