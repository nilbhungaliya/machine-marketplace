import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import type { Condition, MasterData, Unit } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, conditions, units } from '../src/db/schema.js';
import { createUnit as createUnitService, updateUnit as updateUnitService } from '../src/services/catalog/master-admin.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestSeller,
  deleteTestListings,
  deleteTestSellerExtras,
  insertTestListing,
  type TestSeller,
} from './_helpers/test-listings.js';

describe('admin master data API (units, conditions)', () => {
  let app: FastifyInstance;
  let manager: { id: string; token: string };
  let moderator: { id: string; token: string };
  const unitIds: string[] = [];
  const conditionIds: string[] = [];
  const sellers: TestSeller[] = [];
  let seq = 0;

  /** Unique per call; every key created here carries it. */
  const stamp = () => `${Date.now()}${seq++}`;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    manager = await createTestAdmin('category_manager');
    moderator = await createTestAdmin('moderator');
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool. Listings first: they reference the units.
    await deleteTestBusinesses(sellers.map((s) => s.businessId));
    await deleteTestSellerExtras(sellers);
    if (unitIds.length) await db.delete(units).where(inArray(units.id, unitIds));
    if (conditionIds.length) await db.delete(conditions).where(inArray(conditions.id, conditionIds));
    await deleteTestAdmins([manager?.id, moderator?.id].filter((id): id is string => !!id));
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, token = manager.token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as InjectOptions['payload'] });
  }

  async function publicMasterData(): Promise<MasterData> {
    const res = await app.inject({ method: 'GET', url: '/master-data' });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as MasterData;
  }

  async function adminMasterData(): Promise<MasterData> {
    const res = await call('GET', '/admin/master-data');
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as MasterData;
  }

  async function createUnit(body: Record<string, unknown>): Promise<Unit> {
    const res = await call('POST', '/admin/master-data/units', body);
    expect(res.statusCode, res.body).toBe(201);
    const unit = res.json().data as Unit;
    unitIds.push(unit.id);
    return unit;
  }

  async function createCondition(body: Record<string, unknown>): Promise<Condition> {
    const res = await call('POST', '/admin/master-data/conditions', body);
    expect(res.statusCode, res.body).toBe(201);
    const condition = res.json().data as Condition;
    conditionIds.push(condition.id);
    return condition;
  }

  async function audit(action: string, entityId: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.adminId, manager.id), eq(auditLog.action, action), eq(auditLog.entityId, entityId)))
      .orderBy(auditLog.createdAt);
  }

  describe('units', () => {
    it('creates, renames and deactivates a unit; public master data hides it once inactive', async () => {
      const key = `test_unit_${stamp()}`;
      const unit = await createUnit({ key, label: 'Test unit', decimals: 2 });
      expect(unit).toMatchObject({ key, label: 'Test unit', decimals: 2, isActive: true });
      expect((await publicMasterData()).units.map((u) => u.id)).toContain(unit.id);

      const renamed = await call('PATCH', `/admin/master-data/units/${unit.id}`, { label: 'Renamed unit', decimals: 3 });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json().data).toMatchObject({ id: unit.id, key, label: 'Renamed unit', decimals: 3, isActive: true });

      const off = await call('PATCH', `/admin/master-data/units/${unit.id}`, { isActive: false });
      expect(off.statusCode, off.body).toBe(200);
      expect(off.json().data).toMatchObject({ isActive: false });
      expect((await publicMasterData()).units.map((u) => u.id)).not.toContain(unit.id);
      // The admin view still lists it.
      expect((await adminMasterData()).units.find((u) => u.id === unit.id)).toMatchObject({ label: 'Renamed unit', isActive: false });

      const [created] = await audit('unit.create', unit.id);
      expect(created).toMatchObject({ entityType: 'unit', before: null });
      expect(created!.after).toMatchObject({ key, label: 'Test unit', decimals: 2 });
      const updates = await audit('unit.update', unit.id);
      expect(updates).toHaveLength(2);
      expect(updates[0]!.before).toMatchObject({ label: 'Test unit', decimals: 2 });
      expect(updates[0]!.after).toMatchObject({ label: 'Renamed unit', decimals: 3 });
    });

    it('M5 guard: lowering decimals while a listing uses the unit → 409 UNIT_IN_USE; raising and deactivating pass', async () => {
      const unit = await createUnit({ key: `test_unit_${stamp()}`, label: 'Used unit', decimals: 2 });
      const seller = await createTestSeller();
      sellers.push(seller);
      const listing = await insertTestListing(db, {
        businessId: seller.businessId, userId: seller.userId, kind: 'part', status: 'draft', categoryId: null, unitId: unit.id,
      });

      const lower = await call('PATCH', `/admin/master-data/units/${unit.id}`, { decimals: 1 });
      expect(lower.statusCode, lower.body).toBe(409);
      expect(lower.json().code).toBe('UNIT_IN_USE');
      expect((await db.select().from(units).where(eq(units.id, unit.id)))[0]!.decimals).toBe(2);

      const raise = await call('PATCH', `/admin/master-data/units/${unit.id}`, { decimals: 3, label: 'Used unit 2' });
      expect(raise.statusCode, raise.body).toBe(200);
      const off = await call('PATCH', `/admin/master-data/units/${unit.id}`, { isActive: false, decimals: 3 });
      expect(off.statusCode, off.body).toBe(200);

      await deleteTestListings(db, [listing.id]);
      const lowerAfter = await call('PATCH', `/admin/master-data/units/${unit.id}`, { decimals: 0 });
      expect(lowerAfter.statusCode, lowerAfter.body).toBe(200);
    });

    it('isMachineUnit is editable, audited, and shown in public and admin master data', async () => {
      const unit = await createUnit({ key: `test_unit_${stamp()}`, label: 'Machines here' });
      expect(unit.isMachineUnit).toBe(false);
      const on = await call('PATCH', `/admin/master-data/units/${unit.id}`, { isMachineUnit: true });
      expect(on.statusCode, on.body).toBe(200);
      expect(on.json().data).toMatchObject({ id: unit.id, isMachineUnit: true });
      expect((await publicMasterData()).units.find((u) => u.id === unit.id)).toMatchObject({ isMachineUnit: true });
      expect((await adminMasterData()).units.find((u) => u.id === unit.id)).toMatchObject({ isMachineUnit: true });
      const [update] = await audit('unit.update', unit.id);
      expect(update!.before).toMatchObject({ isMachineUnit: false });
      expect(update!.after).toMatchObject({ isMachineUnit: true });

      const off = await call('PATCH', `/admin/master-data/units/${unit.id}`, { isMachineUnit: false });
      expect(off.json().data).toMatchObject({ isMachineUnit: false });
      expect((await call('PATCH', `/admin/master-data/units/${unit.id}`, { isMachineUnit: 'yes' })).statusCode).toBe(400);
    });

    it('decimals defaults to 0; the new unit goes last', async () => {
      const unit = await createUnit({ key: `test_unit_${stamp()}`, label: 'Whole' });
      expect(unit.decimals).toBe(0);
      const all = (await adminMasterData()).units;
      expect(all[all.length - 1]!.id).toBe(unit.id);
    });

    it('rejects a duplicate key with 409 KEY_TAKEN, also when two requests race; a key change with 400 (Review Focus 2)', async () => {
      const key = `test_unit_${stamp()}`;
      const unit = await createUnit({ key, label: 'First' });
      const dup = await call('POST', '/admin/master-data/units', { key, label: 'Second' });
      expect(dup.statusCode, dup.body).toBe(409);
      expect(dup.json().code).toBe('KEY_TAKEN');

      const raceKey = `test_unit_${stamp()}`;
      const results = await Promise.all([
        call('POST', '/admin/master-data/units', { key: raceKey, label: 'A' }),
        call('POST', '/admin/master-data/units', { key: raceKey, label: 'B' }),
      ]);
      for (const r of results) if (r.statusCode === 201) unitIds.push(r.json().data.id);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('KEY_TAKEN');

      const rekey = await call('PATCH', `/admin/master-data/units/${unit.id}`, { key: `${key}_x` });
      expect(rekey.statusCode).toBe(400);
      const badKey = await call('POST', '/admin/master-data/units', { key: 'Bad Key', label: 'Bad' });
      expect(badKey.statusCode).toBe(400);
    });

    it.each([4, -1, 1.5])('rejects decimals %s with 400 and stores nothing', async (decimals) => {
      const key = `test_unit_${stamp()}`;
      const created = await call('POST', '/admin/master-data/units', { key, label: 'Bad', decimals });
      expect(created.statusCode, created.body).toBe(400);
      expect(created.json().code).toBe('VALIDATION_ERROR');
      expect(await db.select().from(units).where(eq(units.key, key))).toHaveLength(0);

      const unit = await createUnit({ key: `test_unit_${stamp()}`, label: 'Good', decimals: 1 });
      const patched = await call('PATCH', `/admin/master-data/units/${unit.id}`, { decimals });
      expect(patched.statusCode, patched.body).toBe(400);
    });

    it('decimals outside 0-3 that get past the route hit the CHECK and come back as 400, not 500', async () => {
      const key = `test_unit_${stamp()}`;
      await expect(createUnitService(db, manager.id, { key, label: 'Bad', decimals: 4 as 0 })).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(await db.select().from(units).where(eq(units.key, key))).toHaveLength(0);

      const unit = await createUnit({ key: `test_unit_${stamp()}`, label: 'Good', decimals: 1 });
      await expect(updateUnitService(db, manager.id, unit.id, { decimals: 9 as 0 })).rejects.toMatchObject({ statusCode: 400 });
      const [stored] = await db.select({ decimals: units.decimals }).from(units).where(eq(units.id, unit.id));
      expect(stored!.decimals).toBe(1);
    });

    it('rejects a stale reorder with 409 STALE_ORDER and changes nothing (Review Focus 5)', async () => {
      const unit = await createUnit({ key: `test_unit_${stamp()}`, label: 'Stale' });
      const before = (await adminMasterData()).units.map((u) => [u.id, u.sortOrder]);
      // A repeated id is never an exact list, whatever other units exist.
      const res = await call('POST', '/admin/master-data/units/reorder', { orderedIds: [unit.id, unit.id] });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe('STALE_ORDER');
      expect((await adminMasterData()).units.map((u) => [u.id, u.sortOrder])).toEqual(before);
    });

    it('rejects a reorder sent with a list read before another unit was added: 409 STALE_ORDER, order unchanged (Review Focus 5)', async () => {
      const before = (await adminMasterData()).units.map((u) => [u.id, u.sortOrder] as const);
      // Added after the list was read (removed in afterAll); the refused reorder writes nothing.
      const added = await createUnit({ key: `test_unit_${stamp()}`, label: 'Added' });
      const res = await call('POST', '/admin/master-data/units/reorder', { orderedIds: before.map(([id]) => id) });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe('STALE_ORDER');
      const after = (await adminMasterData()).units.map((u) => [u.id, u.sortOrder] as const);
      expect(after.filter(([id]) => id !== added.id)).toEqual(before);
    });

    it('404s an unknown unit', async () => {
      const res = await call('PATCH', '/admin/master-data/units/00000000-0000-4000-8000-000000000000', { label: 'X' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('conditions', () => {
    it('creates, renames and deactivates a condition; public master data hides it once inactive', async () => {
      const key = `test_cond_${stamp()}`;
      const condition = await createCondition({ key, label: 'Test condition', description: 'Barely used' });
      expect(condition).toMatchObject({ key, label: 'Test condition', description: 'Barely used', isActive: true });
      expect((await publicMasterData()).conditions.map((c) => c.id)).toContain(condition.id);

      const renamed = await call('PATCH', `/admin/master-data/conditions/${condition.id}`, { label: 'Renamed', description: '  ' });
      expect(renamed.statusCode, renamed.body).toBe(200);
      // Blank description is stored as null.
      expect(renamed.json().data).toMatchObject({ id: condition.id, key, label: 'Renamed', description: null, isActive: true });

      const off = await call('PATCH', `/admin/master-data/conditions/${condition.id}`, { isActive: false });
      expect(off.statusCode, off.body).toBe(200);
      expect((await publicMasterData()).conditions.map((c) => c.id)).not.toContain(condition.id);
      expect((await adminMasterData()).conditions.find((c) => c.id === condition.id)).toMatchObject({ isActive: false });

      const [created] = await audit('condition.create', condition.id);
      expect(created).toMatchObject({ entityType: 'condition', before: null });
      const updates = await audit('condition.update', condition.id);
      expect(updates).toHaveLength(2);
      expect(updates[0]!.before).toMatchObject({ label: 'Test condition', description: 'Barely used' });
      expect(updates[0]!.after).toMatchObject({ label: 'Renamed', description: null });
      expect(updates[1]!.before).toMatchObject({ isActive: true });
      expect(updates[1]!.after).toMatchObject({ isActive: false });
    });

    it('rejects a duplicate key with 409 KEY_TAKEN and a key change with 400 (Review Focus 2)', async () => {
      const key = `test_cond_${stamp()}`;
      const condition = await createCondition({ key, label: 'First' });
      expect(condition.description).toBeNull();
      const dup = await call('POST', '/admin/master-data/conditions', { key, label: 'Second' });
      expect(dup.statusCode, dup.body).toBe(409);
      expect(dup.json().code).toBe('KEY_TAKEN');

      const rekey = await call('PATCH', `/admin/master-data/conditions/${condition.id}`, { key: `${key}_x` });
      expect(rekey.statusCode).toBe(400);
    });

    it('rejects a stale reorder with 409 STALE_ORDER (Review Focus 5)', async () => {
      const condition = await createCondition({ key: `test_cond_${stamp()}`, label: 'Stale' });
      const before = (await adminMasterData()).conditions.map((c) => [c.id, c.sortOrder]);
      // A repeated id is never an exact list, whatever other conditions exist.
      const res = await call('POST', '/admin/master-data/conditions/reorder', { orderedIds: [condition.id, condition.id] });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe('STALE_ORDER');
      expect((await adminMasterData()).conditions.map((c) => [c.id, c.sortOrder])).toEqual(before);
    });

    it('rejects a reorder sent with a list read before another condition was added: 409 STALE_ORDER, order unchanged (Review Focus 5)', async () => {
      const before = (await adminMasterData()).conditions.map((c) => [c.id, c.sortOrder] as const);
      // Added after the list was read (removed in afterAll); the refused reorder writes nothing.
      const added = await createCondition({ key: `test_cond_${stamp()}`, label: 'Added' });
      const res = await call('POST', '/admin/master-data/conditions/reorder', { orderedIds: before.map(([id]) => id) });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe('STALE_ORDER');
      const after = (await adminMasterData()).conditions.map((c) => [c.id, c.sortOrder] as const);
      expect(after.filter(([id]) => id !== added.id)).toEqual(before);
    });
  });

  it('moderator can GET /admin/master-data but writes → 403', async () => {
    expect((await call('GET', '/admin/master-data', undefined, moderator.token)).statusCode).toBe(200);
    const s = stamp();
    const writes = await Promise.all([
      call('POST', '/admin/master-data/units', { key: `test_unit_${s}`, label: 'X' }, moderator.token),
      call('POST', '/admin/master-data/units/reorder', { orderedIds: ['00000000-0000-4000-8000-000000000000'] }, moderator.token),
      call('POST', '/admin/master-data/conditions', { key: `test_cond_${s}`, label: 'X' }, moderator.token),
      call('PATCH', '/admin/master-data/conditions/00000000-0000-4000-8000-000000000000', { label: 'X' }, moderator.token),
    ]);
    for (const r of writes) {
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().code).toBe('FORBIDDEN');
    }
    expect(await db.select().from(units).where(eq(units.key, `test_unit_${s}`))).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/admin/master-data' })).statusCode).toBe(401);
  });
});
