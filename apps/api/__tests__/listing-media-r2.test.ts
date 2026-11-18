import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { MediaPresignResult } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listingMedia } from '../src/db/schema.js';
import { deleteObject, deletePublicObject } from '../src/lib/storage.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { r2TestsEnabled, restoreR2Env } from './_helpers/r2-env.js';

// Listing media against real R2 (F2 plan Task 13 Step 2), behind `R2_TESTS=1`: presign → PUT a small JPEG without
// EXIF → attach → the public URL serves it; a JPEG with EXIF → 400 MEDIA_METADATA and nothing public; delete → gone.

const enabled = r2TestsEnabled();

const b = (...parts: Array<number[] | string>) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const seg = (marker: number, payload: Buffer) =>
  Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
const SOS = seg(0xda, Buffer.alloc(10));
const CLEAN = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, b('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])), SOS, b([0x11, 0x22, 0xff, 0xd9])]);
const EXIF = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, b('Exif\0\0', 'MM\0*', [0, 0, 0, 8])), SOS, b([0xff, 0xd9])]);

let app: FastifyInstance;
let seller: TestSeller | undefined;
let listingId = '';
const incomingLeft: string[] = [];

const auth = () => ({ authorization: `Bearer ${seller!.token}` });

async function upload(full: Buffer, thumb: Buffer): Promise<MediaPresignResult> {
  const res = await app.inject({
    method: 'POST',
    url: `/listings/${listingId}/media/presign`,
    headers: auth(),
    payload: { type: 'photo', files: [{ role: 'full', contentType: 'image/jpeg', size: full.length }, { role: 'thumb', contentType: 'image/jpeg', size: thumb.length }] },
  });
  expect(res.statusCode, res.body).toBe(200);
  const data = res.json().data as MediaPresignResult;
  for (const f of data.files) {
    const put = await fetch(f.url, { method: 'PUT', body: new Uint8Array(f.role === 'full' ? full : thumb), headers: { 'content-type': 'image/jpeg' } });
    expect(put.status, await put.text()).toBe(200);
  }
  return data;
}

const keysOf = (p: MediaPresignResult) => ({ full: p.files.find((f) => f.role === 'full')!.key, thumb: p.files.find((f) => f.role === 'thumb')!.key });

beforeAll(async () => {
  if (!enabled) return;
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  listingId = (await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'draft', photos: 0 })).id;
});

afterAll(async () => {
  if (enabled) {
    for (const key of incomingLeft) await deleteObject(key).catch(() => undefined);
    if (listingId) {
      const rows = await db.select().from(listingMedia).where(eq(listingMedia.listingId, listingId));
      for (const r of rows) for (const k of [r.key, r.thumbKey]) if (k) await deletePublicObject(k).catch(() => undefined);
    }
    if (seller) {
      await deleteTestBusinesses([seller.businessId]);
      await deleteTestSellerExtras([seller]);
    }
    await app?.close();
  }
  restoreR2Env();
});

describe.skipIf(!enabled)('listing media on R2', () => {
  it('attaches a clean JPEG that the public URL serves, refuses one with EXIF, and deletes', async () => {
    const clean = await upload(CLEAN, CLEAN);
    const attached = await app.inject({ method: 'POST', url: `/listings/${listingId}/media`, headers: auth(), payload: { type: 'photo', uploadId: clean.uploadId, keys: keysOf(clean) } });
    expect(attached.statusCode, attached.body).toBe(201);
    const item = attached.json().data as { id: string; url: string };
    const served = await fetch(item.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await served.arrayBuffer()).equals(CLEAN)).toBe(true);

    const exif = await upload(EXIF, CLEAN);
    incomingLeft.push(...Object.values(keysOf(exif)));
    const refused = await app.inject({ method: 'POST', url: `/listings/${listingId}/media`, headers: auth(), payload: { type: 'photo', uploadId: exif.uploadId, keys: keysOf(exif) } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe('MEDIA_METADATA');
    expect(await db.select().from(listingMedia).where(eq(listingMedia.listingId, listingId))).toHaveLength(1);

    const removed = await app.inject({ method: 'DELETE', url: `/listings/${listingId}/media/${item.id}`, headers: auth() });
    expect(removed.statusCode, removed.body).toBe(200);
    if (!(process.env.CLOUDFLARE_ZONE_ID ?? '').trim()) expect((await fetch(item.url)).status).toBe(404);
  });
});
