import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { chatMessages } from '../src/db/schema.js';
import * as storage from '../src/lib/storage.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L1-2: chat photos (F6 + F7 spec §6.8, P11). The storage calls private photos make are mocked: the pipeline (key
// check, sniff, re-encode) runs for real on a JPEG made here.

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

const bytesSpy = vi.mocked(storage.getObjectBytes);

let app: FastifyInstance;
let seller: TestSeller;
let buyer: TestBusinessUser;
let third: TestBusinessUser;
let viewer: { userId: string; token: string };
let jpeg: Buffer;
let threadId: string;
const businessIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const upload = (businessId: string) => `incoming-chat/${businessId}/${randomUUID()}`;

function sendPhotos(token: string, photoKeys: string[], headers: Record<string, string> = {}, clientMessageId = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: `/threads/${threadId}/messages`,
    headers: { ...auth(token), ...headers },
    payload: { clientMessageId, text: 'see photos', photoKeys },
  });
}

const messageCount = async () => (await db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.threadId, threadId))).length;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  third = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId, third.businessId);
  viewer = await addTestMember(seller.businessId, 'viewer');
  jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  const { id: listingId } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '5', priceModel: 'negotiable', pricePaise: 50_000,
  });
  const res = await app.inject({ method: 'POST', url: `/listings/${listingId}/enquiry`, headers: auth(buyer.token), payload: { quick: ['more_photos'] } });
  threadId = res.json().data.threadId;
});

beforeEach(() => {
  bytesSpy.mockReset().mockResolvedValue(jpeg);
  vi.mocked(storage.putPrivateObject).mockReset().mockResolvedValue(undefined);
  vi.mocked(storage.deleteObject).mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await app.close();
});

describe('sending photos', () => {
  it('refuses six photos with TOO_MANY_PHOTOS and sends nothing', async () => {
    const before = await messageCount();
    const res = await sendPhotos(buyer.token, Array.from({ length: 6 }, () => upload(buyer.businessId)));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TOO_MANY_PHOTOS');
    expect(await messageCount()).toBe(before);
  });

  it("refuses another business's upload key with PHOTO_KEY_INVALID, before any storage call", async () => {
    const before = await messageCount();
    const res = await sendPhotos(buyer.token, [upload(third.businessId)]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PHOTO_KEY_INVALID');
    expect(bytesSpy).not.toHaveBeenCalled();
    expect(await messageCount()).toBe(before);
  });

  it('refuses a caption over 2 000 characters before any upload is consumed', async () => {
    const before = await messageCount();
    const res = await app.inject({
      method: 'POST',
      url: `/threads/${threadId}/messages`,
      headers: auth(buyer.token),
      payload: { clientMessageId: randomUUID(), text: 'x'.repeat(2001), photoKeys: [upload(buyer.businessId)] },
    });
    expect(res.statusCode).toBe(400);
    expect(bytesSpy).not.toHaveBeenCalled();
    expect(await messageCount()).toBe(before);
  });

  it('replays a retried send with the same Idempotency-Key: one message, photos finalized once', async () => {
    const before = await messageCount();
    const keys = [upload(buyer.businessId), upload(buyer.businessId)];
    const headers = { 'idempotency-key': randomUUID() };
    const clientMessageId = randomUUID();
    const first = await sendPhotos(buyer.token, keys, headers, clientMessageId);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.photos).toHaveLength(2);
    const again = await sendPhotos(buyer.token, keys, headers, clientMessageId);
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().data.id).toBe(first.json().data.id);
    expect(bytesSpy).toHaveBeenCalledTimes(2);
    expect(await messageCount()).toBe(before + 1);
  });
});

describe('reading photos and presign', () => {
  it('signs URLs for members (a viewer included), 404 for a third business; a viewer cannot presign', async () => {
    const sent = await sendPhotos(buyer.token, [upload(buyer.businessId)]);
    const messageId = sent.json().data.id;
    const url = `/threads/${threadId}/messages/${messageId}/photos`;

    const forViewer = await app.inject({ method: 'GET', url, headers: auth(viewer.token) });
    expect(forViewer.statusCode).toBe(200);
    expect(forViewer.json().data.photos).toHaveLength(1);
    expect(forViewer.json().data.photos[0].url).toMatch(/^https:\/\/private\.test\/chat\//);

    const forThird = await app.inject({ method: 'GET', url, headers: auth(third.token) });
    expect(forThird.statusCode).toBe(404);

    const presign = (token: string) =>
      app.inject({ method: 'POST', url: `/threads/${threadId}/photos/presign`, headers: auth(token), payload: { contentType: 'image/jpeg', contentLength: 1000 } });
    const denied = await presign(viewer.token);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('VIEWER_READ_ONLY');
    const ok = await presign(seller.token);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.key).toMatch(new RegExp(`^incoming-chat/${seller.businessId}/`));
  });
});
