import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { IndustrialArea } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, businesses, industrialAreas, pincodeOffices } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';

// Admin industrial areas (F1 spec §4.3, §8.3). Test pincodes 990005–990006 (inserted here, no real office uses them)
// resolve to this run's own district and state; 990009 is never inserted: the unknown pincode.

const S = `${Date.now()}`;
const PIN_1 = '990005';
const PIN_2 = '990006';
const PIN_UNKNOWN = '990009';
const OUR_PINS = [PIN_1, PIN_2];
const DISTRICT = `KOSAD DIST ${S}`;
const CITY = `Kosad Dist ${S}`;
const STATE = `Adoptland ${S}`;

interface OtherValue {
  text: string;
  district: string;
  state: string;
  count: number;
  adoptable: boolean;
}

describe('admin industrial areas API', () => {
  let app: FastifyInstance;
  let manager: { id: string; token: string };
  let moderator: { id: string; token: string };
  const businessIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    manager = await createTestAdmin('category_manager');
    moderator = await createTestAdmin('moderator');
    await db.delete(pincodeOffices).where(inArray(pincodeOffices.pincode, OUR_PINS));
    await db.insert(pincodeOffices).values([
      { pincode: PIN_1, officeName: 'Kosad', district: DISTRICT, state: STATE },
      { pincode: PIN_2, officeName: 'Amroli', district: DISTRICT, state: STATE },
    ]);
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool. Businesses reference areas: delete them first.
    if (businessIds.length) await db.delete(businesses).where(inArray(businesses.id, businessIds));
    await db.delete(industrialAreas).where(eq(industrialAreas.state, STATE));
    await db.delete(pincodeOffices).where(inArray(pincodeOffices.pincode, OUR_PINS));
    await deleteTestAdmins([manager?.id, moderator?.id].filter((id): id is string => !!id));
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, token = manager.token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as InjectOptions['payload'] });
  }

  async function createArea(name: string, city = CITY, state = STATE): Promise<IndustrialArea> {
    const res = await call('POST', '/admin/industrial-areas', { name, city, state });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as IndustrialArea;
  }

  async function insertBusiness(values: { pincode: string; city: string; other?: string; areaId?: string }): Promise<string> {
    const [row] = await db
      .insert(businesses)
      .values({
        tradeName: `Area Test Works ${S} ${businessIds.length}`,
        pincode: values.pincode,
        city: values.city,
        state: STATE,
        industrialAreaOther: values.other ?? null,
        industrialAreaId: values.areaId ?? null,
      })
      .returning({ id: businesses.id });
    businessIds.push(row!.id);
    return row!.id;
  }

  async function publicAreas(pincode: string): Promise<IndustrialArea[]> {
    const res = await app.inject({ method: 'GET', url: `/locations/industrial-areas?pincode=${pincode}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as IndustrialArea[];
  }

  async function auditRows(action: string, entityId?: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.adminId, manager.id), eq(auditLog.action, action), entityId ? eq(auditLog.entityId, entityId) : undefined));
  }

  it('creates an area at the end of its city, lists it for admins and for the pincode', async () => {
    const first = await createArea(`Sachin GIDC ${S}`);
    const second = await createArea(`Pandesara GIDC ${S}`);
    expect(first).toMatchObject({ name: `Sachin GIDC ${S}`, city: CITY, state: STATE, isActive: true });
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);

    const list = await call('GET', `/admin/industrial-areas?state=${encodeURIComponent(STATE)}`);
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json().data as IndustrialArea[]).map((a) => a.id)).toEqual([first.id, second.id]);
    expect((await publicAreas(PIN_1)).map((a) => a.id)).toEqual([first.id, second.id]);
    expect(await auditRows('industrial_area.create', first.id)).toHaveLength(1);
  });

  it('refuses a duplicate name in the same city, ignoring case and spaces: 409 NAME_TAKEN', async () => {
    await createArea(`Hojiwala ${S}`);
    const res = await call('POST', '/admin/industrial-areas', { name: `  hojiwala ${S} `, city: CITY.toUpperCase(), state: STATE });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe('NAME_TAKEN');
  });

  it('renames an area, refusing a name another area has', async () => {
    const area = await createArea(`Katargm ${S}`);
    const renamed = await call('PATCH', `/admin/industrial-areas/${area.id}`, { name: `Katargam GIDC ${S}` });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().data).toMatchObject({ id: area.id, name: `Katargam GIDC ${S}` });

    const clash = await call('PATCH', `/admin/industrial-areas/${area.id}`, { name: `SACHIN GIDC ${S}` });
    expect(clash.statusCode, clash.body).toBe(409);
    expect(clash.json().code).toBe('NAME_TAKEN');

    const audits = await auditRows('industrial_area.update', area.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toMatchObject({ name: `Katargm ${S}` });
    expect(audits[0]!.after).toMatchObject({ name: `Katargam GIDC ${S}` });
  });

  it('deactivating hides the area from the public picker but not from admins', async () => {
    const area = await createArea(`Udhna ${S}`);
    const res = await call('PATCH', `/admin/industrial-areas/${area.id}`, { isActive: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.isActive).toBe(false);
    expect((await publicAreas(PIN_1)).map((a) => a.id)).not.toContain(area.id);
    const list = await call('GET', `/admin/industrial-areas?city=${encodeURIComponent(CITY)}&state=${encodeURIComponent(STATE)}`);
    expect((list.json().data as IndustrialArea[]).find((a) => a.id === area.id)).toMatchObject({ isActive: false });
  });

  it('PATCH with nothing to change is a 400', async () => {
    const area = await createArea(`Empty Patch ${S}`);
    const res = await call('PATCH', `/admin/industrial-areas/${area.id}`, {});
    expect(res.statusCode).toBe(400);
  });

  it('reorders the areas of a city; a stale list is 409 STALE_ORDER', async () => {
    const list = await call('GET', `/admin/industrial-areas?city=${encodeURIComponent(CITY)}&state=${encodeURIComponent(STATE)}`);
    const ids = (list.json().data as IndustrialArea[]).map((a) => a.id);
    expect(ids.length).toBeGreaterThan(2);

    const stale = await call('POST', '/admin/industrial-areas/reorder', { city: CITY, state: STATE, ids: ids.slice(1) });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().code).toBe('STALE_ORDER');

    const reversed = [...ids].reverse();
    const ok = await call('POST', '/admin/industrial-areas/reorder', { city: CITY, state: STATE, ids: reversed });
    expect(ok.statusCode, ok.body).toBe(200);
    const after = await call('GET', `/admin/industrial-areas?city=${encodeURIComponent(CITY)}&state=${encodeURIComponent(STATE)}`);
    expect((after.json().data as IndustrialArea[]).map((a) => a.id)).toEqual(reversed);
    expect(await auditRows('industrial_area.reorder')).toHaveLength(1);
  });

  it('refuses to delete an area a business uses (409 AREA_IN_USE) and deletes an unused one', async () => {
    const used = await createArea(`Bhestan ${S}`);
    await insertBusiness({ pincode: PIN_1, city: CITY, areaId: used.id });
    const refused = await call('DELETE', `/admin/industrial-areas/${used.id}`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().code).toBe('AREA_IN_USE');

    const unused = await createArea(`Limbayat ${S}`);
    const deleted = await call('DELETE', `/admin/industrial-areas/${unused.id}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(await db.select().from(industrialAreas).where(eq(industrialAreas.id, unused.id))).toHaveLength(0);
    expect(await auditRows('industrial_area.delete', unused.id)).toHaveLength(1);

    const again = await call('DELETE', `/admin/industrial-areas/${unused.id}`);
    expect(again.statusCode).toBe(404);
  });

  it('refuses a moderator: 403', async () => {
    expect((await call('GET', '/admin/industrial-areas', undefined, moderator.token)).statusCode).toBe(403);
    const res = await call('POST', '/admin/industrial-areas', { name: `Nope ${S}`, city: CITY, state: STATE }, moderator.token);
    expect(res.statusCode).toBe(403);
    expect((await call('GET', '/admin/industrial-areas/other', undefined, moderator.token)).statusCode).toBe(403);
  });

  describe('"Other" values', () => {
    const typed = `Kosad Estate ${S}`;
    const text = typed.toLowerCase();
    let a = '';
    let b = '';
    let unknown = '';

    beforeAll(async () => {
      a = await insertBusiness({ pincode: PIN_1, city: CITY, other: typed });
      // Another pincode of the same district, another case, a trailing space and an edited city: still the same row.
      b = await insertBusiness({ pincode: PIN_2, city: 'Surat City', other: `${text} ` });
      // A pincode the directory doesn't have: listed under its typed city, not adoptable.
      unknown = await insertBusiness({ pincode: PIN_UNKNOWN, city: CITY, other: typed });
    });

    async function others(): Promise<OtherValue[]> {
      const res = await call('GET', '/admin/industrial-areas/other');
      expect(res.statusCode, res.body).toBe(200);
      return (res.json().data as OtherValue[]).filter((o) => o.text === text);
    }

    it("groups the typed texts by the pincode's district and state, most-typed first", async () => {
      expect(await others()).toEqual([
        { text, district: DISTRICT, state: STATE, count: 2, adoptable: true },
        { text, district: CITY, state: STATE, count: 1, adoptable: false },
      ]);
    });

    it('refuses to adopt for a district the directory does not have: 400 UNKNOWN_DISTRICT', async () => {
      const res = await call('POST', '/admin/industrial-areas/other/adopt', { text, district: `Nowhere ${S}`, state: STATE, name: typed });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('UNKNOWN_DISTRICT');
    });

    it('Add to list creates the area and links every matching business of that district; the unknown pincode stays', async () => {
      const res = await call('POST', '/admin/industrial-areas/other/adopt', { text, district: DISTRICT, state: STATE, name: typed });
      expect(res.statusCode, res.body).toBe(200);
      const { areaId, linked } = res.json().data as { areaId: string; linked: number };
      expect(linked).toBe(2);

      const [area] = await db.select().from(industrialAreas).where(eq(industrialAreas.id, areaId));
      expect(area).toMatchObject({ name: typed, city: CITY, state: STATE, isActive: true });

      const rows = await db
        .select({ id: businesses.id, areaId: businesses.industrialAreaId, other: businesses.industrialAreaOther })
        .from(businesses)
        .where(inArray(businesses.id, [a, b, unknown]));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(a)).toMatchObject({ areaId, other: null });
      expect(byId.get(b)).toMatchObject({ areaId, other: null });
      expect(byId.get(unknown)).toMatchObject({ areaId: null, other: typed });

      expect((await publicAreas(PIN_2)).map((x) => x.id)).toContain(areaId);
      expect(await others()).toEqual([{ text, district: CITY, state: STATE, count: 1, adoptable: false }]);

      const audits = await auditRows('industrial_area.adopt', areaId);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.after).toMatchObject({ linked: 2 });
    });
  });

  it('every write above left exactly its audit rows (no audit for refused writes)', async () => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.adminId, moderator.id)));
    expect(row!.n).toBe(0);
  });
});
