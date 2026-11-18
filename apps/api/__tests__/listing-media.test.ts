import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listingMedia, listings } from '../src/db/schema.js';
import * as storage from '../src/lib/storage.js';
import { purgeUrls } from '../src/lib/cdn-purge.js';
import { videoUploadEnabled } from '../src/lib/media-switch.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestSeller,
  deleteTestSellerExtras,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Listing media, offline (F2 plan Task 13, spec §6.2–§6.4, Review Focus #3): R2 is never called. `storage.ts` keeps its
// real configuration checks and key helpers, with the network functions replaced; the CDN purge and the video switch are
// mocked. Fake media variables are set per test and restored after.

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return {
    ...real,
    headObject: vi.fn(),
    getObjectBytes: vi.fn(),
    copyToPublic: vi.fn(),
    deletePublicObject: vi.fn(),
    deleteObject: vi.fn(),
    presignSignedPut: vi.fn(),
  };
});
vi.mock('../src/lib/cdn-purge.js', () => ({ purgeUrls: vi.fn() }));
vi.mock('../src/lib/media-switch.js', () => ({ videoUploadEnabled: vi.fn() }));

const m = {
  head: vi.mocked(storage.headObject),
  bytes: vi.mocked(storage.getObjectBytes),
  copy: vi.mocked(storage.copyToPublic),
  delPublic: vi.mocked(storage.deletePublicObject),
  delPrivate: vi.mocked(storage.deleteObject),
  presign: vi.mocked(storage.presignSignedPut),
  purge: vi.mocked(purgeUrls),
  video: vi.mocked(videoUploadEnabled),
};

const MEDIA_ENV: Record<string, string> = {
  AWS_S3_ENDPOINT: 'http://127.0.0.1:9',
  AWS_REGION: 'auto',
  AWS_ACCESS_KEY_ID: 'test-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_S3_PRIVATE_BUCKET: 'test-private',
  AWS_S3_PUBLIC_BUCKET: 'test-public',
  MEDIA_PUBLIC_BASE_URL: 'https://media.example.test/',
};
const savedEnv: Record<string, string | undefined> = {};

// ─── Byte fixtures ───
const b = (...parts: Array<number[] | string>) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const seg = (marker: number, payload: Buffer) => b([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload.toString('latin1'));
const SOS = seg(0xda, Buffer.alloc(10));
const CLEAN_JPEG = b([0xff, 0xd8], seg(0xe0, b('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])).toString('latin1'), SOS.toString('latin1'), [0x11, 0x22, 0xff, 0xd9]);
const EXIF_JPEG = b([0xff, 0xd8], seg(0xe1, b('Exif\0\0', 'MM\0*', [0, 0, 0, 8])).toString('latin1'), SOS.toString('latin1'), [0xff, 0xd9]);
const ftyp = (brand: string) => b([0, 0, 0, 0x20], 'ftyp', brand, [0, 0, 0, 0], 'isommp41');
const HTML = b('<!doctype html><html><script>alert(1)</script></html>');

/** What each incoming key's first bytes are (default: a clean JPEG for `.jpg`, an `isom` MP4 for `.mp4` / `.mov`). */
const bytesOf = new Map<string, Buffer>();
const sizeOf = new Map<string, number>();

let app: FastifyInstance;
let seller: TestSeller;
let rival: TestSeller;
const sellers: TestSeller[] = [];

const auth = (s: TestSeller) => ({ authorization: `Bearer ${s.token}` });
const presign = (s: TestSeller, id: string, body: unknown) =>
  app.inject({ method: 'POST', url: `/listings/${id}/media/presign`, headers: auth(s), payload: body as object });
const attach = (s: TestSeller, id: string, body: unknown) =>
  app.inject({ method: 'POST', url: `/listings/${id}/media`, headers: auth(s), payload: body as object });
const order = (s: TestSeller, id: string, ids: string[]) =>
  app.inject({ method: 'PUT', url: `/listings/${id}/media/order`, headers: auth(s), payload: { ids } });
const del = (s: TestSeller, id: string, mediaId: string) =>
  app.inject({ method: 'DELETE', url: `/listings/${id}/media/${mediaId}`, headers: auth(s) });

const photoFiles = [
  { role: 'full', contentType: 'image/jpeg', size: 400_000 },
  { role: 'thumb', contentType: 'image/jpeg', size: 60_000 },
];
const videoFiles = [
  { role: 'video', contentType: 'video/mp4', size: 20_000_000 },
  { role: 'poster', contentType: 'image/jpeg', size: 90_000 },
];

const incoming = (s: TestSeller, listingId: string, uploadId: string, ext = 'jpg') =>
  `incoming-listing/${s.businessId}/${listingId}/${uploadId}/${randomUUID()}.${ext}`;
const photoBody = (s: TestSeller, listingId: string, uploadId = randomUUID()) => ({
  type: 'photo',
  uploadId,
  keys: { full: incoming(s, listingId, uploadId), thumb: incoming(s, listingId, uploadId) },
});
const videoBody = (s: TestSeller, listingId: string, durationMs: number | null = 30_000, uploadId = randomUUID()) => ({
  type: 'video',
  uploadId,
  keys: { video: incoming(s, listingId, uploadId, 'mp4'), poster: incoming(s, listingId, uploadId) },
  ...(durationMs === null ? {} : { durationMs }),
});

async function listingOf(s: TestSeller, extra: Partial<TestListingOptions> = {}): Promise<string> {
  const { id } = await insertTestListing(db, { businessId: s.businessId, userId: s.userId, kind: 'part', categoryId: null, ...extra });
  return id;
}
async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}
async function mediaOf(id: string) {
  return db.select().from(listingMedia).where(eq(listingMedia.listingId, id)).orderBy(listingMedia.sortOrder);
}
function noStorageCalls() {
  expect(m.head).not.toHaveBeenCalled();
  expect(m.bytes).not.toHaveBeenCalled();
  expect(m.copy).not.toHaveBeenCalled();
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  rival = await createTestSeller();
  sellers.push(seller, rival);
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await app.close();
});

beforeEach(() => {
  for (const [k, v] of Object.entries(MEDIA_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  vi.clearAllMocks();
  bytesOf.clear();
  sizeOf.clear();
  m.presign.mockImplementation(async (key, _ct, _len) => ({
    url: `https://r2.example.test/${key}?X-Amz-Signature=x`,
    key,
    expiresAt: new Date(Date.now() + 300_000),
  }));
  m.head.mockImplementation(async (key) => ({ contentLength: sizeOf.get(key) ?? 50_000, contentType: null, etag: null }));
  m.bytes.mockImplementation(async (key) => bytesOf.get(key) ?? (key.endsWith('.jpg') ? CLEAN_JPEG : ftyp('isom')));
  m.copy.mockResolvedValue(undefined);
  m.delPublic.mockResolvedValue(undefined);
  m.delPrivate.mockResolvedValue(undefined);
  m.purge.mockResolvedValue('ok');
  m.video.mockReturnValue(true);
});

afterEach(() => {
  for (const k of Object.keys(MEDIA_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('storage not configured', () => {
  it('every media endpoint answers 503 STORAGE_UNAVAILABLE', async () => {
    const id = await listingOf(seller, { photos: 2 });
    const [first] = await mediaOf(id);
    for (const unset of ['AWS_S3_PUBLIC_BUCKET', 'MEDIA_PUBLIC_BASE_URL', 'AWS_S3_PRIVATE_BUCKET']) {
      process.env[unset] = '';
      const answers = [
        await presign(seller, id, { type: 'photo', files: photoFiles }),
        await attach(seller, id, photoBody(seller, id)),
        await order(seller, id, (await mediaOf(id)).map((r) => r.id)),
        await del(seller, id, first!.id),
      ];
      for (const res of answers) {
        expect(res.statusCode, `${unset}: ${res.body}`).toBe(503);
        expect(res.json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE', error: "Photo upload isn't available yet" });
      }
      process.env[unset] = MEDIA_ENV[unset];
    }
    noStorageCalls();
    expect(await mediaOf(id)).toHaveLength(2);
  });

  it('in production also needs the Cloudflare zone and token', () => {
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(storage.isMediaStorageConfigured()).toBe(false);
      process.env.CLOUDFLARE_ZONE_ID = 'z';
      process.env.CLOUDFLARE_API_TOKEN = 't';
      expect(storage.isMediaStorageConfigured()).toBe(true);
    } finally {
      process.env.NODE_ENV = before;
      process.env.CLOUDFLARE_ZONE_ID = '';
      process.env.CLOUDFLARE_API_TOKEN = '';
    }
    expect(storage.isMediaStorageConfigured()).toBe(true);
  });
});

describe('POST /listings/:id/media/presign', () => {
  it('signs a photo’s full and thumb under one uploadId, and again under the same id on a retry', async () => {
    const id = await listingOf(seller, { status: 'draft', photos: 0 });
    const res = await presign(seller, id, { type: 'photo', files: photoFiles });
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data as { uploadId: string; files: Array<{ role: string; key: string; url: string; expiresAt: string }> };
    expect(data.files.map((f) => f.role)).toEqual(['full', 'thumb']);
    for (const f of data.files) {
      expect(f.key).toMatch(new RegExp(`^incoming-listing/${seller.businessId}/${id}/${data.uploadId}/[0-9a-f-]{36}\\.jpg$`));
      expect(new Date(f.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
    expect(m.presign).toHaveBeenCalledWith(data.files[0]!.key, 'image/jpeg', 400_000);
    expect(m.presign).toHaveBeenCalledWith(data.files[1]!.key, 'image/jpeg', 60_000);

    const again = await presign(seller, id, { type: 'photo', uploadId: data.uploadId, files: photoFiles });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.uploadId).toBe(data.uploadId);
    expect(again.json().data.files[0].key).not.toBe(data.files[0]!.key);
  });

  it('a QuickTime video gets a .mov key', async () => {
    const id = await listingOf(seller);
    const res = await presign(seller, id, { type: 'video', files: [{ ...videoFiles[0], contentType: 'video/quicktime' }, videoFiles[1]] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.files[0].key).toMatch(/\.mov$/);
  });

  it('an 11th photo or a 3rd video → 409 MEDIA_LIMIT', async () => {
    const full = await listingOf(seller, { photos: 10, videos: 2 });
    const photo = await presign(seller, full, { type: 'photo', files: photoFiles });
    expect(photo.statusCode).toBe(409);
    expect(photo.json()).toMatchObject({ code: 'MEDIA_LIMIT', details: { type: 'photo', max: 10 } });
    const video = await presign(seller, full, { type: 'video', files: videoFiles });
    expect(video.json()).toMatchObject({ code: 'MEDIA_LIMIT', details: { type: 'video', max: 2 } });
    expect(m.presign).not.toHaveBeenCalled();
  });

  it('a 5 MB full → 413 MEDIA_TOO_LARGE; a PNG or wrong roles → 400', async () => {
    const id = await listingOf(seller);
    const big = await presign(seller, id, { type: 'photo', files: [{ ...photoFiles[0], size: 5 * 1024 * 1024 }, photoFiles[1]] });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ code: 'MEDIA_TOO_LARGE', details: { role: 'full', maxBytes: 4_194_304 } });
    const bigVideo = await presign(seller, id, { type: 'video', files: [{ ...videoFiles[0], size: 52_428_801 }, videoFiles[1]] });
    expect(bigVideo.json().code).toBe('MEDIA_TOO_LARGE');

    const png = await presign(seller, id, { type: 'photo', files: [{ ...photoFiles[0], contentType: 'image/png' }, photoFiles[1]] });
    expect(png.statusCode).toBe(400);
    expect(png.json().code).toBe('MEDIA_TYPE');
    const heic = await presign(seller, id, { type: 'photo', files: [{ ...photoFiles[0], contentType: 'image/heic' }, photoFiles[1]] });
    expect(heic.json().code).toBe('MEDIA_TYPE');

    const roles = await presign(seller, id, { type: 'photo', files: [photoFiles[0], videoFiles[1]] });
    expect(roles.statusCode).toBe(400);
    const twice = await presign(seller, id, { type: 'photo', files: [photoFiles[0], photoFiles[0]] });
    expect(twice.statusCode).toBe(400);
    expect(m.presign).not.toHaveBeenCalled();
  });

  it("another business's listing → 404; a hidden one → 409 LISTING_NOT_EDITABLE", async () => {
    const theirs = await listingOf(rival);
    expect((await presign(seller, theirs, { type: 'photo', files: photoFiles })).statusCode).toBe(404);
    const hidden = await listingOf(seller, { status: 'hidden', returnStatus: 'live' });
    const res = await presign(seller, hidden, { type: 'photo', files: photoFiles });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LISTING_NOT_EDITABLE');
  });

  it('video while the switch is off → 400 MEDIA_TYPE; photos still sign', async () => {
    m.video.mockReturnValue(false);
    const id = await listingOf(seller);
    const res = await presign(seller, id, { type: 'video', files: videoFiles });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MEDIA_TYPE');
    expect(m.presign).not.toHaveBeenCalled();
    expect((await presign(seller, id, { type: 'photo', files: photoFiles })).statusCode).toBe(200);
  });
});

describe('POST /listings/:id/media (attach)', () => {
  it('checks, copies with the sniffed type, inserts at the next sort order, bumps version and refreshed_at, deletes the incoming files', async () => {
    const id = await listingOf(seller, { photos: 2, refreshedAt: new Date(Date.now() - 86_400_000) });
    const before = await rowOf(id);
    const body = photoBody(seller, id);
    const res = await attach(seller, id, body);
    expect(res.statusCode, res.body).toBe(201);
    const item = res.json().data;
    expect(item).toMatchObject({ type: 'photo', contentType: 'image/jpeg', sortOrder: 2, durationMs: null, sizeBytes: 50_000 });
    expect(item.url).toBe(`https://media.example.test/listings/${id}/${item.id}/full.jpg`);
    expect(item.thumbUrl).toBe(`https://media.example.test/listings/${id}/${item.id}/thumb.jpg`);

    const [row] = await db.select().from(listingMedia).where(eq(listingMedia.id, item.id));
    expect(row).toMatchObject({ key: `listings/${id}/${item.id}/full.jpg`, thumbKey: `listings/${id}/${item.id}/thumb.jpg` });
    expect(m.copy).toHaveBeenCalledWith(body.keys.full, `listings/${id}/${item.id}/full.jpg`, { contentType: 'image/jpeg' });
    expect(m.copy).toHaveBeenCalledWith(body.keys.thumb, `listings/${id}/${item.id}/thumb.jpg`, { contentType: 'image/jpeg' });
    expect(m.bytes).toHaveBeenCalledWith(body.keys.full, { range: { start: 0, end: 65_535 } });
    expect(m.delPrivate.mock.calls.map((c) => c[0]).sort()).toEqual([body.keys.full, body.keys.thumb].sort());
    expect(m.delPublic).not.toHaveBeenCalled();

    const after = await rowOf(id);
    expect(after.version).toBe(before.version + 1);
    expect(after.refreshedAt!.getTime()).toBeGreaterThan(before.refreshedAt!.getTime());
  });

  it('a draft keeps refreshed_at null', async () => {
    const id = await listingOf(seller, { status: 'draft', photos: 0 });
    expect((await attach(seller, id, photoBody(seller, id))).statusCode).toBe(201);
    const row = await rowOf(id);
    expect(row.refreshedAt).toBeNull();
    expect(row.version).toBe(2);
  });

  it('a video: the stored key and type follow the sniff (QuickTime bytes in a .mp4 upload → video.mov), duration stored', async () => {
    const id = await listingOf(seller);
    const body = videoBody(seller, id, 45_000);
    bytesOf.set(body.keys.video, ftyp('qt  '));
    sizeOf.set(body.keys.video, 30_000_000);
    const res = await attach(seller, id, body);
    expect(res.statusCode, res.body).toBe(201);
    const item = res.json().data;
    expect(item).toMatchObject({ type: 'video', contentType: 'video/quicktime', durationMs: 45_000, sizeBytes: 30_000_000 });
    expect(item.url).toBe(`https://media.example.test/listings/${id}/${item.id}/video.mov`);
    expect(item.thumbUrl).toBe(`https://media.example.test/listings/${id}/${item.id}/poster.jpg`);
    expect(m.copy).toHaveBeenCalledWith(body.keys.video, `listings/${id}/${item.id}/video.mov`, { contentType: 'video/quicktime' });
  });

  it('another business / listing / uploadId, a foreign extension or a traversal in a key → 400 MEDIA_KEY_INVALID, no storage call', async () => {
    const id = await listingOf(seller);
    const other = await listingOf(seller);
    const uploadId = randomUUID();
    const good = incoming(seller, id, uploadId);
    const bad = [
      incoming(rival, id, uploadId),
      incoming(seller, other, uploadId),
      incoming(seller, id, randomUUID()),
      incoming(seller, id, uploadId, 'png'),
      `incoming-listing/${seller.businessId}/${id}/${uploadId}/../${randomUUID()}.jpg`,
      `incoming-verification/${seller.businessId}/${uploadId}/${randomUUID()}.jpg`,
      `listings/${id}/${randomUUID()}/full.jpg`,
    ];
    for (const key of bad) {
      const res = await attach(seller, id, { type: 'photo', uploadId, keys: { full: key, thumb: good } });
      expect(res.statusCode, key).toBe(400);
      expect(res.json().code).toBe('MEDIA_KEY_INVALID');
    }
    const same = await attach(seller, id, { type: 'photo', uploadId, keys: { full: good, thumb: good } });
    expect(same.json().code).toBe('MEDIA_KEY_INVALID');
    noStorageCalls();
  });

  it("another business's listing → 404 with no storage call", async () => {
    const theirs = await listingOf(rival);
    const res = await attach(seller, theirs, photoBody(seller, theirs));
    expect(res.statusCode).toBe(404);
    noStorageCalls();
  });

  it('a missing upload (head null, head or copy throwing ObjectMissingError) → 400 MEDIA_MISSING, copies made are deleted', async () => {
    const id = await listingOf(seller);
    m.head.mockResolvedValueOnce(null);
    expect((await attach(seller, id, photoBody(seller, id))).json().code).toBe('MEDIA_MISSING');

    m.head.mockRejectedValueOnce(new storage.ObjectMissingError('x'));
    expect((await attach(seller, id, photoBody(seller, id))).json().code).toBe('MEDIA_MISSING');

    m.copy.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new storage.ObjectMissingError('x'));
    const res = await attach(seller, id, photoBody(seller, id));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MEDIA_MISSING');
    const firstTarget = m.copy.mock.calls[0]![1];
    expect(m.delPublic).toHaveBeenCalledWith(firstTarget);
    expect(await mediaOf(id)).toHaveLength(1);
  });

  it('over its role’s cap at head → 413 MEDIA_TOO_LARGE, nothing copied', async () => {
    const id = await listingOf(seller);
    const body = photoBody(seller, id);
    sizeOf.set(body.keys.thumb, 1_048_577);
    const res = await attach(seller, id, body);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'MEDIA_TOO_LARGE', details: { role: 'thumb' } });
    expect(m.copy).not.toHaveBeenCalled();
  });

  it('HTML, PNG, HEIC and AVIF bytes → 400 MEDIA_TYPE, nothing copied or attached', async () => {
    const id = await listingOf(seller);
    const cases: Array<{ role: 'full' | 'video'; bytes: Buffer }> = [
      { role: 'full', bytes: HTML },
      { role: 'full', bytes: b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
      { role: 'full', bytes: ftyp('heic') },
      { role: 'video', bytes: ftyp('heic') },
      { role: 'video', bytes: ftyp('mif1') },
      { role: 'video', bytes: ftyp('avif') },
      { role: 'video', bytes: HTML },
    ];
    for (const c of cases) {
      const body = c.role === 'full' ? photoBody(seller, id) : videoBody(seller, id);
      bytesOf.set(c.role === 'full' ? (body.keys as { full: string }).full : (body.keys as { video: string }).video, c.bytes);
      const res = await attach(seller, id, body);
      expect(res.statusCode, `${c.role} ${c.bytes.subarray(0, 12).toString('latin1')}`).toBe(400);
      expect(res.json().code).toBe('MEDIA_TYPE');
    }
    expect(m.copy).not.toHaveBeenCalled();
    expect(await mediaOf(id)).toHaveLength(1);
  });

  it('a JPEG with EXIF (full, thumb or poster) → 400 MEDIA_METADATA, nothing public', async () => {
    const id = await listingOf(seller);
    for (const role of ['full', 'thumb'] as const) {
      const body = photoBody(seller, id);
      bytesOf.set(body.keys[role], EXIF_JPEG);
      const res = await attach(seller, id, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'MEDIA_METADATA', details: { role } });
    }
    const video = videoBody(seller, id);
    bytesOf.set(video.keys.poster, EXIF_JPEG);
    expect((await attach(seller, id, video)).json().code).toBe('MEDIA_METADATA');
    expect(m.copy).not.toHaveBeenCalled();
    expect(await mediaOf(id)).toHaveLength(1);
  });

  it('a JPEG whose header runs past the first 64 KB → 400 MEDIA_METADATA (EXIF could hide there)', async () => {
    const id = await listingOf(seller);
    const body = photoBody(seller, id);
    const app2 = Buffer.alloc(65_000);
    bytesOf.set(body.keys.full, b([0xff, 0xd8, 0xff, 0xe2, 0xfd, 0xea], app2.toString('latin1')).subarray(0, 65_536));
    expect((await attach(seller, id, body)).json().code).toBe('MEDIA_METADATA');
  });

  it('a JPEG with an XMP packet (APP1) → 400 MEDIA_METADATA, nothing copied', async () => {
    const id = await listingOf(seller);
    const body = photoBody(seller, id);
    bytesOf.set(body.keys.full, b([0xff, 0xd8], seg(0xe1, b('http://ns.adobe.com/xap/1.0/\0', '<exif:GPSLatitude>21,10N</exif:GPSLatitude>')).toString('latin1'), SOS.toString('latin1'), [0xff, 0xd9]));
    const res = await attach(seller, id, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'MEDIA_METADATA', details: { role: 'full' } });
    expect(m.copy).not.toHaveBeenCalled();
  });

  it("passes HEAD's ETag to the range read (IfMatch) and the copy (CopySourceIfMatch)", async () => {
    const id = await listingOf(seller);
    const body = photoBody(seller, id);
    m.head.mockImplementation(async (key) => ({ contentLength: 50_000, contentType: null, etag: `"etag-${key.slice(-8)}"` }));
    expect((await attach(seller, id, body)).statusCode).toBe(201);
    for (const key of [body.keys.full, body.keys.thumb]) {
      const etag = `"etag-${key.slice(-8)}"`;
      expect(m.bytes).toHaveBeenCalledWith(key, { range: { start: 0, end: 65_535 }, ifMatch: etag });
      expect(m.copy).toHaveBeenCalledWith(key, expect.stringMatching(/^listings\//), { contentType: 'image/jpeg', ifMatch: etag });
    }
  });

  it('bytes changed after HEAD (a precondition failure on the read or the copy) → 400 MEDIA_MISSING, copies deleted', async () => {
    const id = await listingOf(seller);
    m.head.mockResolvedValue({ contentLength: 50_000, contentType: null, etag: '"v1"' });
    m.bytes.mockRejectedValueOnce(new storage.PreconditionFailedError('x'));
    expect((await attach(seller, id, photoBody(seller, id))).json().code).toBe('MEDIA_MISSING');

    m.copy.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new storage.PreconditionFailedError('x'));
    const res = await attach(seller, id, photoBody(seller, id));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MEDIA_MISSING');
    expect(m.delPublic).toHaveBeenCalledWith(m.copy.mock.calls[0]![1]);
    expect(await mediaOf(id)).toHaveLength(1);
  });

  it('a video over 60.5 s or without a duration → 400 VIDEO_TOO_LONG and no storage call', async () => {
    const id = await listingOf(seller);
    for (const durationMs of [61_000, 60_501, null]) {
      const res = await attach(seller, id, videoBody(seller, id, durationMs));
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VIDEO_TOO_LONG');
    }
    noStorageCalls();
    expect((await attach(seller, id, videoBody(seller, id, 60_500))).statusCode).toBe(201);
  });

  it('video while the switch is off → 400 MEDIA_TYPE and no storage call', async () => {
    m.video.mockReturnValue(false);
    const id = await listingOf(seller);
    const res = await attach(seller, id, videoBody(seller, id));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MEDIA_TYPE');
    noStorageCalls();
  });

  it('at 10 photos → 409 MEDIA_LIMIT before storage', async () => {
    const id = await listingOf(seller, { photos: 10 });
    const res = await attach(seller, id, photoBody(seller, id));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('MEDIA_LIMIT');
    noStorageCalls();
  });

  it('a failed incoming delete after commit is logged, not thrown', async () => {
    const id = await listingOf(seller);
    m.delPrivate.mockRejectedValue(new Error('R2 down'));
    expect((await attach(seller, id, photoBody(seller, id))).statusCode).toBe(201);
  });

  it('two concurrent attaches at 9 photos: one 201, one 409 MEDIA_LIMIT, the loser’s public copies deleted', async () => {
    const id = await listingOf(seller, { photos: 9 });
    // Hold every attach at its first copy until both have passed the pre-check, so both reach the transaction.
    let arrived = 0;
    let release!: () => void;
    const bothCopying = new Promise<void>((resolve) => (release = resolve));
    m.copy.mockImplementation(async (_from, to) => {
      if (to.endsWith('/full.jpg') && ++arrived === 2) release();
      await Promise.race([bothCopying, new Promise((r) => setTimeout(r, 5_000))]);
    });

    const [a, c] = await Promise.all([attach(seller, id, photoBody(seller, id)), attach(seller, id, photoBody(seller, id))]);
    expect(arrived).toBe(2);
    const statuses = [a.statusCode, c.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.statusCode === 409 ? a : c;
    expect(loser.json().code).toBe('MEDIA_LIMIT');

    const rows = await mediaOf(id);
    expect(rows.filter((r) => r.type === 'photo')).toHaveLength(10);
    const winnerKeys = new Set(rows.flatMap((r) => [r.key, r.thumbKey]));
    const loserKeys = m.copy.mock.calls.map((call) => call[1]).filter((k) => !winnerKeys.has(k));
    expect(loserKeys).toHaveLength(2);
    expect(m.delPublic.mock.calls.map((call) => call[0]).sort()).toEqual(loserKeys.sort());
  });
});

describe('the shipped video switch (amendment 3)', () => {
  // The real `videoUploadEnabled` (the mock above stands in for it everywhere else). Video ships off until the native
  // spike has run on a device: when the owner turns `LISTING_VIDEO_UPLOAD_ENABLED` on
  // (docs/superpowers/spikes/2026-11-18-f2-native-media.md), this test is the one to flip.
  it('is off: presign and attach of a video → 400 MEDIA_TYPE with no storage call', async () => {
    const real = await vi.importActual<typeof import('../src/lib/media-switch.js')>('../src/lib/media-switch.js');
    expect(real.videoUploadEnabled()).toBe(false);
    m.video.mockImplementation(real.videoUploadEnabled);
    const id = await listingOf(seller);
    const signed = await presign(seller, id, { type: 'video', files: videoFiles });
    expect(signed.statusCode).toBe(400);
    expect(signed.json().code).toBe('MEDIA_TYPE');
    const attached = await attach(seller, id, videoBody(seller, id));
    expect(attached.statusCode).toBe(400);
    expect(attached.json().code).toBe('MEDIA_TYPE');
    expect(m.presign).not.toHaveBeenCalled();
    noStorageCalls();
  });
});

describe('PUT /listings/:id/media/order', () => {
  it('a different set → 400 MEDIA_ORDER_INVALID; the full set reorders and bumps the version', async () => {
    const id = await listingOf(seller, { photos: 3, videos: 1 });
    const ids = (await mediaOf(id)).map((r) => r.id);
    for (const wrong of [ids.slice(1), [...ids, randomUUID()], [ids[0]!, ids[0]!, ids[1]!, ids[2]!], [...ids.slice(0, 3), randomUUID()]]) {
      const res = await order(seller, id, wrong);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('MEDIA_ORDER_INVALID');
    }
    const before = await rowOf(id);
    const wanted = [ids[2]!, ids[3]!, ids[0]!, ids[1]!];
    const res = await order(seller, id, wanted);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.map((x: { id: string }) => x.id)).toEqual(wanted);
    expect((await mediaOf(id)).map((r) => r.id)).toEqual(wanted);
    expect((await rowOf(id)).version).toBe(before.version + 1);
  });

  it("another business's listing → 404", async () => {
    const theirs = await listingOf(rival, { photos: 1 });
    expect((await order(seller, theirs, (await mediaOf(theirs)).map((r) => r.id))).statusCode).toBe(404);
  });
});

describe('DELETE /listings/:id/media/:mediaId', () => {
  it('the last photo of a live listing → 409 MEDIA_LAST_PHOTO; of a draft → 200', async () => {
    const live = await listingOf(seller, { photos: 1, videos: 1 });
    const [photo] = (await mediaOf(live)).filter((r) => r.type === 'photo');
    const res = await del(seller, live, photo!.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('MEDIA_LAST_PHOTO');
    expect(m.delPublic).not.toHaveBeenCalled();

    const draft = await listingOf(seller, { status: 'draft', photos: 1 });
    const [only] = await mediaOf(draft);
    expect((await del(seller, draft, only!.id)).statusCode).toBe(200);
  });

  it('the dev switch lets the last photo of a live listing go', async () => {
    process.env.LISTING_MEDIA_OPTIONAL = 'true';
    try {
      const live = await listingOf(seller, { photos: 1 });
      const [only] = await mediaOf(live);
      expect((await del(seller, live, only!.id)).statusCode).toBe(200);
    } finally {
      process.env.LISTING_MEDIA_OPTIONAL = 'false';
    }
  });

  it('another photo: row gone, version + 1, refreshed, objects deleted and the exact URLs purged', async () => {
    const id = await listingOf(seller, { photos: 2, refreshedAt: new Date(Date.now() - 86_400_000) });
    const before = await rowOf(id);
    const [first] = await mediaOf(id);
    const res = await del(seller, id, first!.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toEqual({ id: first!.id, deleted: true });
    expect(await db.select().from(listingMedia).where(and(eq(listingMedia.id, first!.id)))).toHaveLength(0);
    const after = await rowOf(id);
    expect(after.version).toBe(before.version + 1);
    expect(after.refreshedAt!.getTime()).toBeGreaterThan(before.refreshedAt!.getTime());
    expect(m.delPublic.mock.calls.map((c) => c[0]).sort()).toEqual([first!.key, first!.thumbKey!].sort());
    expect(m.purge).toHaveBeenCalledTimes(1);
    expect(m.purge.mock.calls[0]![0].sort()).toEqual(
      [`https://media.example.test/${first!.key}`, `https://media.example.test/${first!.thumbKey}`].sort(),
    );
  });

  it('a video goes even with one photo left; a failed object delete or purge still answers 200', async () => {
    const id = await listingOf(seller, { photos: 1, videos: 1 });
    const [video] = (await mediaOf(id)).filter((r) => r.type === 'video');
    m.delPublic.mockRejectedValue(new Error('R2 down'));
    m.purge.mockResolvedValue('failed');
    expect((await del(seller, id, video!.id)).statusCode).toBe(200);
    expect(await mediaOf(id)).toHaveLength(1);
  });

  it("an unknown media id → 404 MEDIA_NOT_FOUND; another business's listing → 404; a hidden listing → 409", async () => {
    const id = await listingOf(seller, { photos: 2 });
    const missing = await del(seller, id, randomUUID());
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('MEDIA_NOT_FOUND');

    const other = await listingOf(seller, { photos: 2 });
    const [otherMedia] = await mediaOf(other);
    expect((await del(seller, id, otherMedia!.id)).json().code).toBe('MEDIA_NOT_FOUND');

    const theirs = await listingOf(rival, { photos: 2 });
    const [theirMedia] = await mediaOf(theirs);
    expect((await del(seller, theirs, theirMedia!.id)).statusCode).toBe(404);

    const hidden = await listingOf(seller, { status: 'hidden', returnStatus: 'live', photos: 2 });
    const [hiddenMedia] = await mediaOf(hidden);
    expect((await del(seller, hidden, hiddenMedia!.id)).json().code).toBe('LISTING_NOT_EDITABLE');
    expect(m.delPublic).not.toHaveBeenCalled();
  });
});
