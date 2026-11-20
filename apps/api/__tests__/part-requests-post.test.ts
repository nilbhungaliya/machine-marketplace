import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, machineModels, partRequestWork, partRequests, templateFields } from '../src/db/schema.js';
import * as storage from '../src/lib/storage.js';
import * as privatePhoto from '../src/services/chat/private-photo.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestBrand, deleteTestBrands, type TestBrand } from './_helpers/test-catalog.js';
import { addTestMember } from './_helpers/test-deals.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  type TestSeller,
} from './_helpers/test-listings.js';
import { countF8Rows, createTestPartTree, type TestPartTree } from './_helpers/test-part-requests.js';

// F8 A1-1: posting a requirement (spec §5.1, §9.1 `post`, §12.1, §17; plan A1-1). Storage calls are mocked; the photo
// pipeline (key check, sniff, re-encode) runs for real on a JPEG made here.

const flags = vi.hoisted(() => ({
  failEnqueue: false,
  /** When set, the next enqueue (inside the post's transaction) calls `entered` and waits for `release`. */
  hold: null as null | { entered: () => void; release: Promise<void> },
}));

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return {
    ...real,
    getObjectBytes: vi.fn(),
    putPrivateObject: vi.fn(),
    deleteObject: vi.fn(),
    presignSignedPut: vi.fn(async (key: string) => ({ url: `https://upload.test/${key}`, key, expiresAt: new Date(Date.now() + 300_000) })),
    presignPrivateGet: vi.fn(async (key: string) => `https://private.test/${key}?sig=1`),
  };
});
vi.mock('../src/services/chat/private-photo.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/chat/private-photo.js')>();
  return { ...real, finalizePrivatePhotos: vi.fn(real.finalizePrivatePhotos) };
});
vi.mock('../src/services/part-requests/work-queue.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/part-requests/work-queue.js')>();
  return {
    ...real,
    enqueuePartRequestWork: vi.fn(async (...args: Parameters<typeof real.enqueuePartRequestWork>) => {
      if (flags.failEnqueue) throw new Error('forced failure');
      const hold = flags.hold;
      if (hold) {
        flags.hold = null;
        hold.entered();
        await hold.release;
      }
      return real.enqueuePartRequestWork(...args);
    }),
  };
});

const SURAT = { lat: 21.17, lng: 72.83 };
const SETTING_KEYS = [
  'part_request_open_limit_unverified',
  'part_request_open_limit_verified',
  'part_request_posts_per_day',
];

let app: FastifyInstance;
let tree: TestPartTree;
let flat: TestPartTree;
let machineUnit: { id: string };
let brand: TestBrand;
let otherBrand: TestBrand;
let otherModelId: string;
let jpeg: Buffer;
const sellers: TestSeller[] = [];
const businessIds: string[] = [];

const finalizeSpy = vi.mocked(privatePhoto.finalizePrivatePhotos);
const auth = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const upload = (businessId: string) => `incoming-chat/${businessId}/${randomUUID()}`;

async function business(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: tree.machineCategory.id, point: SURAT, ...opts });
  sellers.push(s);
  businessIds.push(s.businessId);
  return s;
}

const partBody = (o: Record<string, unknown> = {}) => ({
  kind: 'part',
  categoryId: tree.partGroup.id,
  name: 'Temple roller',
  side: 'left',
  quantity: '2',
  unitId: tree.unitId,
  reach: 'radius_200',
  audience: 'any_seller',
  validityDays: 15,
  ...o,
});

const post = (token: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/part-requests', headers: auth(token, headers), payload });

const rowsOf = (businessId: string) => db.select().from(partRequests).where(eq(partRequests.businessId, businessId));

async function setSettings(values: Record<string, number>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  tree = await createTestPartTree();
  flat = await createTestPartTree({ hasSides: false });
  machineUnit = await createTestMachineUnit();
  brand = await createTestBrand();
  otherBrand = await createTestBrand();
  const [m] = await db
    .insert(machineModels)
    .values({ key: `other_${Date.now()}`, brandId: otherBrand.id, machineTypeId: tree.machineType.id, name: 'Other model' })
    .returning({ id: machineModels.id });
  otherModelId = m!.id;
  jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#808080' } }).jpeg().toBuffer();
});

beforeEach(() => {
  flags.failEnqueue = false;
  flags.hold = null;
  finalizeSpy.mockClear();
  vi.mocked(storage.getObjectBytes).mockReset().mockResolvedValue(jpeg);
  vi.mocked(storage.putPrivateObject).mockReset().mockResolvedValue(undefined);
  vi.mocked(storage.deleteObject).mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras(sellers);
  await tree.cleanup();
  await flat.cleanup();
  await deleteTestBrands([brand.id, otherBrand.id]);
  await deleteTestUnits([machineUnit.id]);
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app.close();
});

describe('limits (§12.1)', () => {
  it('refuses the 3rd active request of an unverified business at a limit of 2', async () => {
    const b = await business();
    await setSettings({ part_request_open_limit_unverified: 2, part_request_open_limit_verified: 3 });
    try {
      expect((await post(b.token, partBody())).statusCode).toBe(201);
      expect((await post(b.token, partBody())).statusCode).toBe(201);
      const res = await post(b.token, partBody());
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'PART_REQUEST_OPEN_LIMIT', details: { limit: 2 } });
    } finally {
      await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
    }
  });

  it('a GST-verified business gets the verified limit (3rd allowed, 4th refused)', async () => {
    const b = await business({ gst: true });
    await setSettings({ part_request_open_limit_unverified: 2, part_request_open_limit_verified: 3 });
    try {
      for (let i = 0; i < 3; i++) expect((await post(b.token, partBody())).statusCode).toBe(201);
      const res = await post(b.token, partBody());
      expect(res.json()).toMatchObject({ code: 'PART_REQUEST_OPEN_LIMIT', details: { limit: 3 } });
    } finally {
      await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
    }
  });

  it('refuses a post past the daily limit (IST day, any status)', async () => {
    const b = await business();
    await setSettings({ part_request_posts_per_day: 2 });
    try {
      const first = await post(b.token, partBody());
      expect(first.statusCode).toBe(201);
      // A closed request still counts toward the day.
      await db.update(partRequests).set({ status: 'closed', closeReason: 'other', closedAt: new Date() }).where(eq(partRequests.id, first.json().data.id));
      expect((await post(b.token, partBody())).statusCode).toBe(201);
      const res = await post(b.token, partBody());
      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe('PART_REQUEST_DAILY_LIMIT');
    } finally {
      await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
    }
  });
});

describe('fields (§5.1, §5.2)', () => {
  // A fresh business per case: the open and daily limits would stop a shared one.
  let b: TestSeller;
  beforeEach(async () => {
    b = await business();
  });

  it('side: required on a node with sides, refused on one without', async () => {
    const missing = await post(b.token, partBody({ side: undefined }));
    expect(missing.json().code).toBe('SIDE_REQUIRED');
    const notApplicable = await post(b.token, partBody({ side: 'not_applicable' }));
    expect(notApplicable.json().code).toBe('SIDE_REQUIRED');
    const flatSide = await post(b.token, partBody({ categoryId: flat.partGroup.id, unitId: flat.unitId, side: 'left' }));
    expect(flatSide.json().code).toBe('SIDE_NOT_ALLOWED');
    const flatNone = await post(b.token, partBody({ categoryId: flat.partGroup.id, unitId: flat.unitId, side: null }));
    expect(flatNone.statusCode).toBe(201);
    expect(flatNone.json().data.side).toBeNull();
  });

  it('a machine request: no part number; the machine unit and quantity 1', async () => {
    const machine = { kind: 'machine', categoryId: tree.machineType.id, name: 'Rapier loom', reach: 'all_india', audience: 'any_seller', validityDays: 15 };
    const withNumber = await post(b.token, { ...machine, partNumber: 'AB-123' });
    expect(withNumber.statusCode).toBe(400);
    const res = await post(b.token, machine);
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ kind: 'machine', quantity: '1', side: null, unit: { id: machineUnit.id } });
  });

  it('specs: a required field may be left empty; an unknown option is SPECS_INVALID', async () => {
    await db.update(templateFields).set({ required: true }).where(and(eq(templateFields.categoryId, tree.partGroup.id), eq(templateFields.key, 'temple_type')));
    const empty = await post(b.token, partBody({ specs: { temple_type: '' } }));
    expect(empty.statusCode).toBe(201);
    expect(empty.json().data.specs).toEqual({});
    const bad = await post(b.token, partBody({ specs: { temple_type: 'nope' } }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'SPECS_INVALID', details: { temple_type: 'invalid_option' } });
    const ok = await post(b.token, partBody({ specs: { temple_type: 'ring' } }));
    expect(ok.json().data.specs).toEqual({ temple_type: 'ring' });
  });

  it('fits: at most 5; a model of another brand is MODEL_INVALID', async () => {
    const six = Array.from({ length: 6 }, () => ({ brandId: brand.id }));
    expect((await post(b.token, partBody({ fits: six }))).statusCode).toBe(400);
    const wrong = await post(b.token, partBody({ fits: [{ brandId: brand.id, modelId: otherModelId }] }));
    expect(wrong.json().code).toBe('MODEL_INVALID');
    const ok = await post(b.token, partBody({ fits: [{ brandId: otherBrand.id, modelId: otherModelId, yearFrom: 2015, yearTo: 2020 }] }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.fits).toEqual([
      { brandId: otherBrand.id, brandName: otherBrand.name, modelId: otherModelId, modelName: 'Other model', yearFrom: 2015, yearTo: 2020 },
    ]);
  });

  it('validity must be one of the three settings', async () => {
    const res = await post(b.token, partBody({ validityDays: 10 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDITY_INVALID');
  });

  it('the created row: business pin as its point, one target_request work row, scam note flagged, name masked', async () => {
    const res = await post(b.token, partBody({ name: 'Roller call +91 98765 43210', note: 'Send advance first' }));
    expect(res.statusCode).toBe(201);
    const view = res.json().data;
    expect(view).toMatchObject({ role: 'buyer', status: 'active', noteFlagged: true, version: 1, validityDays: 15 });
    expect(view.name).not.toContain('98765');
    const [row] = await db
      .select({
        same: sql<boolean>`ST_Equals(${partRequests.point}::geometry, (SELECT location::geometry FROM businesses WHERE id = ${b.businessId}))`,
        days: sql<number>`round(extract(epoch from (${partRequests.expiresAt} - ${partRequests.createdAt})) / 86400)::int`,
        name: partRequests.name,
      })
      .from(partRequests)
      .where(eq(partRequests.id, view.id));
    expect(row).toMatchObject({ same: true, days: 15, name: 'Roller call +91 98765 43210' });
    const work = await db.select().from(partRequestWork).where(eq(partRequestWork.subjectId, view.id));
    expect(work).toHaveLength(1);
    expect(work[0]!.kind).toBe('target_request');
  });
});

describe('who may post', () => {
  it('needs finished onboarding; a viewer is refused', async () => {
    const half = await business({ onboarded: false });
    const res = await post(half.token, partBody());
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ONBOARDING_INCOMPLETE');
    const b = await business();
    const viewer = await addTestMember(b.businessId, 'viewer');
    const v = await post(viewer.token, partBody());
    expect(v.statusCode).toBe(403);
    expect(v.json().code).toBe('VIEWER_READ_ONLY');
  });
});

describe('photos (§17)', () => {
  it("another business's upload key is PHOTO_KEY_INVALID and writes no request", async () => {
    const b = await business();
    const other = await business();
    const res = await post(b.token, partBody({ photoKeys: [upload(other.businessId)] }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PHOTO_KEY_INVALID');
    expect(await rowsOf(b.businessId)).toHaveLength(0);
  });

  it('the same Idempotency-Key twice: one row, the same body, photos finalised once', async () => {
    const b = await business();
    const headers = { 'idempotency-key': randomUUID() };
    const payload = partBody({ photoKeys: [upload(b.businessId)] });
    const first = await post(b.token, payload, headers);
    const second = await post(b.token, payload, headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(finalizeSpy).toHaveBeenCalledTimes(1);
    const rows = await rowsOf(b.businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.photoKeys).toHaveLength(1);
    expect(rows[0]!.photoKeys[0]).toMatch(new RegExp(`^part-request/${rows[0]!.id}/[0-9a-f-]+\\.jpg$`));
  });

  it('a retry sent while the first post is in flight replays the stored 201 and creates no duplicate', async () => {
    const b = await business();
    // Storage as it really behaves: a deleted upload reads as missing.
    const deletedKeys = new Set<string>();
    vi.mocked(storage.deleteObject).mockImplementation(async (key: string) => {
      deletedKeys.add(key);
    });
    vi.mocked(storage.getObjectBytes).mockImplementation(async (key: string) => (deletedKeys.has(key) ? null : jpeg));
    let entered!: () => void;
    const inTx = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    flags.hold = { entered: () => entered(), release: new Promise<void>((r) => (release = r)) };

    const uploadKey = upload(b.businessId);
    const headers = { 'idempotency-key': randomUUID() };
    const payload = partBody({ photoKeys: [uploadKey] });
    const first = post(b.token, payload, headers);
    await inTx; // the first post holds the key's lock inside its transaction, its upload still in storage
    const retry = post(b.token, payload, headers);
    // Let the retry finalise its own copy before the first commits (it then waits on the key's lock).
    for (let i = 0; i < 200 && vi.mocked(storage.putPrivateObject).mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    release();
    const [a, r] = await Promise.all([first, retry]);

    expect(a.statusCode).toBe(201);
    expect(r.statusCode).toBe(201);
    expect(r.headers['idempotent-replay']).toBe('true');
    expect(r.json()).toEqual(a.json());
    const rows = await rowsOf(b.businessId);
    expect(rows).toHaveLength(1);
    // The upload is gone after commit, and so is the retry's unused copy; the stored photo is kept.
    const finals = vi.mocked(storage.putPrivateObject).mock.calls.map((c) => c[0]);
    expect(finals).toHaveLength(2);
    expect(deletedKeys.has(uploadKey)).toBe(true);
    for (const k of finals) expect(deletedKeys.has(k)).toBe(!rows[0]!.photoKeys.includes(k));
  });

  it('a post refused by the open limit or by SIDE_REQUIRED never finalises photos', async () => {
    const b = await business();
    await setSettings({ part_request_open_limit_unverified: 1 });
    try {
      expect((await post(b.token, partBody())).statusCode).toBe(201);
      const limited = await post(b.token, partBody({ photoKeys: [upload(b.businessId)] }));
      expect(limited.json().code).toBe('PART_REQUEST_OPEN_LIMIT');
    } finally {
      await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
    }
    const sideless = await post(b.token, partBody({ side: null, photoKeys: [upload(b.businessId)] }));
    expect(sideless.json().code).toBe('SIDE_REQUIRED');
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it('a transaction failure after finalising deletes the final copies', async () => {
    const b = await business();
    flags.failEnqueue = true;
    const res = await post(b.token, partBody({ photoKeys: [upload(b.businessId), upload(b.businessId)] }));
    expect(res.statusCode).toBe(500);
    const finals = vi.mocked(storage.putPrivateObject).mock.calls.map((c) => c[0]);
    expect(finals).toHaveLength(2);
    const deleted = vi.mocked(storage.deleteObject).mock.calls.map((c) => c[0]);
    for (const k of finals) expect(deleted).toContain(k);
    expect(await rowsOf(b.businessId)).toHaveLength(0);
  });
});
