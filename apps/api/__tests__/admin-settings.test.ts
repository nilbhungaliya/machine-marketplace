import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { APP_SETTINGS, appSettingDefaults, type AppSettingsView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, auditLog } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Marketplace settings (F2 spec §11.5, §12; plan Task 3): super-admin only, defaults without rows, one audit row per
// save, and the expiry impact preview (R56).

const KEYS = APP_SETTINGS.map((s) => s.key);
const DAY = 24 * 60 * 60 * 1000;

describe('admin settings API', () => {
  let app: FastifyInstance;
  let superAdmin: { id: string; token: string };
  let moderator: { id: string; token: string };
  let catalog: TestCatalog;
  let seller: TestSeller;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    superAdmin = await createTestAdmin('super_admin');
    moderator = await createTestAdmin('moderator');
    catalog = await createTestCatalog();
    seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  });

  afterEach(async () => {
    await db.delete(appSettings).where(inArray(appSettings.key, KEYS));
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool.
    await deleteTestBusinesses(seller ? [seller.businessId] : []);
    await deleteTestSellerExtras(seller ? [seller] : []);
    await deleteTestAdmins([superAdmin?.id, moderator?.id].filter((id): id is string => !!id));
    if (catalog) await deleteTestCatalog(catalog.categoryId);
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, token = superAdmin.token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as InjectOptions['payload'] });
  }

  it('answers the defaults when no row exists', async () => {
    const res = await call('GET', '/admin/settings');
    expect(res.statusCode).toBe(200);
    const view = res.json().data as AppSettingsView;
    expect(view.values).toEqual(appSettingDefaults());
    expect(view.registry.map((s) => s.key)).toEqual(KEYS);
  });

  it('saves a setting and writes one setting.update audit row', async () => {
    const res = await call('PATCH', '/admin/settings', { listing_expiry_days: 30 });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as AppSettingsView).values.listing_expiry_days).toBe(30);

    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'listing_expiry_days'));
    expect(row!.value).toBe(30);
    expect(row!.updatedByAdminId).toBe(superAdmin.id);

    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.adminId, superAdmin.id), eq(auditLog.action, 'setting.update')));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.entityType).toBe('setting');
    expect(audit[0]!.before).toEqual({ listing_expiry_days: 60 });
    expect(audit[0]!.after).toEqual({ listing_expiry_days: 30 });

    const again = await call('GET', '/admin/settings');
    expect((again.json().data as AppSettingsView).values.listing_expiry_days).toBe(30);
  });

  it('refuses a reminder that is not shorter than the expiry', async () => {
    const res = await call('PATCH', '/admin/settings', { listing_expiry_days: 10, listing_expiry_reminder_days: 10 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'SETTING_INVALID', details: { key: 'listing_expiry_reminder_days' } });
    expect(await db.select().from(appSettings).where(inArray(appSettings.key, KEYS))).toHaveLength(0);
  });

  it('checks the reminder against the stored expiry', async () => {
    expect((await call('PATCH', '/admin/settings', { listing_expiry_days: 20 })).statusCode).toBe(200);
    const res = await call('PATCH', '/admin/settings', { listing_expiry_reminder_days: 25 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'SETTING_INVALID', details: { key: 'listing_expiry_reminder_days' } });
  });

  it('refuses out-of-range, non-integer and unknown settings', async () => {
    const tooLong = await call('PATCH', '/admin/settings', { listing_expiry_days: 400 });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ code: 'SETTING_INVALID', details: { key: 'listing_expiry_days' } });
    const zeroCap = await call('PATCH', '/admin/settings', { unverified_listing_cap: 0 });
    expect(zeroCap.json()).toMatchObject({ code: 'SETTING_INVALID', details: { key: 'unverified_listing_cap' } });
    const fraction = await call('PATCH', '/admin/settings', { listing_review_first_n: 1.5 });
    expect(fraction.json()).toMatchObject({ code: 'SETTING_INVALID', details: { key: 'listing_review_first_n' } });
    expect((await call('PATCH', '/admin/settings', { no_such_setting: 1 })).statusCode).toBe(400);
    expect((await call('PATCH', '/admin/settings', {})).statusCode).toBe(400);
  });

  it('is super-admin only', async () => {
    expect((await call('GET', '/admin/settings', undefined, moderator.token)).statusCode).toBe(403);
    expect((await call('PATCH', '/admin/settings', { listing_expiry_days: 30 }, moderator.token)).statusCode).toBe(403);
    expect((await call('GET', '/admin/settings/expiry-impact?days=30', undefined, moderator.token)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/settings' })).statusCode).toBe(401);
  });

  it('counts live and rented listings a lower expiry would expire, not paused ones', async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * DAY);
    const base = { businessId: seller.businessId, userId: seller.userId };
    await insertTestListing(db, { ...base, kind: 'part', status: 'live', categoryId: catalog.partGroupId, refreshedAt: fortyDaysAgo });
    await insertTestListing(db, {
      ...base, kind: 'machine_rental', status: 'rented', categoryId: catalog.machineTypeId, refreshedAt: fortyDaysAgo,
    });
    await insertTestListing(db, { ...base, kind: 'part', status: 'paused', categoryId: catalog.partGroupId, refreshedAt: fortyDaysAgo });
    await insertTestListing(db, {
      ...base, kind: 'part', status: 'live', categoryId: catalog.partGroupId, refreshedAt: new Date(Date.now() - 10 * DAY),
    });

    const at30 = await call('GET', '/admin/settings/expiry-impact?days=30');
    expect(at30.statusCode).toBe(200);
    expect(at30.json().data).toEqual({ days: 30, count: 2 });
    const at60 = await call('GET', '/admin/settings/expiry-impact?days=60');
    expect(at60.json().data).toEqual({ days: 60, count: 0 });
  });

  it('refuses an expiry-impact window outside 7–365 days', async () => {
    expect((await call('GET', '/admin/settings/expiry-impact?days=6')).statusCode).toBe(400);
    expect((await call('GET', '/admin/settings/expiry-impact?days=366')).statusCode).toBe(400);
    expect((await call('GET', '/admin/settings/expiry-impact')).statusCode).toBe(400);
  });
});
