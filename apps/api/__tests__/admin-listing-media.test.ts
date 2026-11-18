import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, listingMedia, listingStatusHistory, listings } from '../src/db/schema.js';
import * as storage from '../src/lib/storage.js';
import { purgeUrls } from '../src/lib/cdn-purge.js';
import { applyAdminTransition } from '../src/services/listings/listing-lifecycle.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestListingOptions, type TestSeller } from './_helpers/test-listings.js';

// Admin media delete (F2 plan Task 16, spec §11.3, R52, R53, amendment 2): `DELETE /admin/listings/:id/media/:mediaId
// { reason }`, moderators only, never checks the version; the last photo of a listing on its public side moves it to
// `rejected`; one `listing_media.delete` audit row; objects deleted and URLs purged after commit; `{ purge }`.
// Storage is mocked (no R2); the purge runs for real against no zone (`skipped`) unless a test makes it fail.

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return { ...real, deletePublicObject: vi.fn(), deleteObject: vi.fn() };
});
vi.mock('../src/lib/cdn-purge.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/cdn-purge.js')>();
  return { ...real, purgeUrls: vi.fn(real.purgeUrls) };
});

const deletePublic = vi.mocked(storage.deletePublicObject);
const purge = vi.mocked(purgeUrls);

const MEDIA_ENV: Record<string, string> = {
  AWS_S3_ENDPOINT: 'http://127.0.0.1:9',
  AWS_REGION: 'auto',
  AWS_ACCESS_KEY_ID: 'test-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_S3_PRIVATE_BUCKET: 'test-private',
  AWS_S3_PUBLIC_BUCKET: 'test-public',
  MEDIA_PUBLIC_BASE_URL: 'https://media.example.test',
};
const savedEnv: Record<string, string | undefined> = {};

let app: FastifyInstance;
let seller: TestSeller;
let moderator: { id: string; token: string };
let support: { id: string; token: string };
let superAdmin: { id: string; token: string };
const REASON = 'Shows a phone number and a watermark';

const remove = (admin: { token: string }, id: string, mediaId: string, body: unknown = { reason: REASON }) =>
  app.inject({
    method: 'DELETE',
    url: `/admin/listings/${id}/media/${mediaId}`,
    headers: { authorization: `Bearer ${admin.token}` },
    payload: body as object,
  });

async function listingOf(extra: Partial<TestListingOptions> = {}) {
  return insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, ...extra });
}
async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}
async function mediaRow(mediaId: string) {
  const [row] = await db.select().from(listingMedia).where(eq(listingMedia.id, mediaId));
  return row;
}
async function auditsOf(listingId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'listing'), eq(auditLog.entityId, listingId)))
    .orderBy(desc(auditLog.createdAt));
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
  superAdmin = await createTestAdmin('super_admin');
});

afterAll(async () => {
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([moderator.id, support.id, superAdmin.id]);
  await app.close();
});

beforeEach(() => {
  for (const [k, v] of Object.entries(MEDIA_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  deletePublic.mockReset();
  deletePublic.mockResolvedValue(undefined);
  purge.mockClear();
});

afterEach(() => {
  for (const k of Object.keys(MEDIA_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('DELETE /admin/listings/:id/media/:mediaId', () => {
  it('deletes one of two photos: row gone, version + 1, status unchanged, audit row, objects deleted, exact URLs purged, purge skipped without a zone', async () => {
    const { id, mediaIds } = await listingOf({ photos: 2, version: 4 });
    const before = await mediaRow(mediaIds[0]!);
    const res = await remove(moderator, id, mediaIds[0]!);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toEqual({ purge: 'skipped' });

    expect(await mediaRow(mediaIds[0]!)).toBeUndefined();
    const row = await rowOf(id);
    expect(row.status).toBe('live');
    expect(row.version).toBe(5);

    expect(deletePublic.mock.calls.map((c) => c[0]).sort()).toEqual([before!.key, before!.thumbKey!].sort());
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge.mock.calls[0]![0].sort()).toEqual(
      [`https://media.example.test/${before!.key}`, `https://media.example.test/${before!.thumbKey}`].sort(),
    );

    const [audit] = await auditsOf(id);
    expect(audit).toMatchObject({ adminId: moderator.id, action: 'listing_media.delete', entityType: 'listing', entityId: id });
    expect(audit!.before).toMatchObject({ media: { id: mediaIds[0], type: 'photo', key: before!.key }, status: 'live', version: 4 });
    expect(audit!.after).toMatchObject({ status: 'live', version: 5, reason: REASON });
  });

  it.each(['live', 'paused', 'expired', 'unavailable', 'sold', 'rented'] as ListingStatus[])(
    'the last photo of a %s listing → rejected (photos_removed, changes requested, the reason as the note)',
    async (status) => {
      const { id, mediaIds } = await listingOf({
        status,
        photos: 1,
        ...(status === 'rented' ? { kind: 'machine_rental', machine: {}, rental: {} } : {}),
      });
      const res = await remove(moderator, id, mediaIds[0]!);
      expect(res.statusCode, res.body).toBe(200);
      const row = await rowOf(id);
      expect(row).toMatchObject({
        status: 'rejected',
        moderationOutcome: 'changes_requested',
        moderationNote: REASON,
        moderatedBy: moderator.id,
        returnStatus: null,
      });
      const [history] = await db
        .select()
        .from(listingStatusHistory)
        .where(eq(listingStatusHistory.listingId, id))
        .orderBy(desc(listingStatusHistory.createdAt));
      expect(history).toMatchObject({ fromStatus: status, toStatus: 'rejected', action: 'photos_removed', actor: 'system', adminId: moderator.id, reason: REASON });
      const [audit] = await auditsOf(id);
      expect(audit!.after).toMatchObject({ status: 'rejected' });
    },
  );

  it('the last photo of a hidden listing: stays hidden, and unhide then refuses with 400 LISTING_INCOMPLETE', async () => {
    const { id, mediaIds } = await listingOf({ status: 'hidden', returnStatus: 'live', photos: 1 });
    expect((await remove(moderator, id, mediaIds[0]!)).statusCode).toBe(200);
    const row = await rowOf(id);
    expect(row.status).toBe('hidden');
    await expect(db.transaction((tx) => applyAdminTransition(tx, moderator.id, row, 'unhide'))).rejects.toMatchObject({
      statusCode: 400,
      code: 'LISTING_INCOMPLETE',
    });
    expect((await rowOf(id)).status).toBe('hidden');
  });

  it('the last photo of a pending_review listing: stays in review (approve refuses it without a photo)', async () => {
    const { id, mediaIds } = await listingOf({ status: 'pending_review', reviewReasons: ['unverified_seller'], photos: 1 });
    expect((await remove(moderator, id, mediaIds[0]!)).statusCode).toBe(200);
    const row = await rowOf(id);
    expect(row.status).toBe('pending_review');
    await expect(db.transaction((tx) => applyAdminTransition(tx, moderator.id, row, 'approve', { version: row.version }))).rejects.toMatchObject({
      code: 'LISTING_INCOMPLETE',
    });
  });

  it('a video leaves the status alone even with one photo', async () => {
    const { id, mediaIds } = await listingOf({ photos: 1, videos: 1 });
    expect((await remove(moderator, id, mediaIds[1]!)).statusCode).toBe(200);
    expect((await rowOf(id)).status).toBe('live');
    expect(await mediaRow(mediaIds[0]!)).toBeDefined();
  });

  it('never checks the version (R53), and a super admin may do it', async () => {
    const { id, mediaIds } = await listingOf({ photos: 3, version: 17 });
    expect((await remove(superAdmin, id, mediaIds[0]!)).statusCode).toBe(200);
    expect((await remove(moderator, id, mediaIds[1]!, { reason: REASON, version: 1 })).statusCode).toBe(400); // body is strict
    expect((await rowOf(id)).version).toBe(18);
  });

  it("a failed purge answers { purge: 'failed' }; a failed object delete still answers 200", async () => {
    const { id, mediaIds } = await listingOf({ photos: 3 });
    purge.mockResolvedValueOnce('failed');
    deletePublic.mockRejectedValue(new Error('R2 down'));
    const res = await remove(moderator, id, mediaIds[0]!);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toEqual({ purge: 'failed' });
    expect(await mediaRow(mediaIds[0]!)).toBeUndefined();
  });

  it('a support admin → 403; a missing or short reason → 400; nothing deleted, no audit', async () => {
    const { id, mediaIds } = await listingOf({ photos: 2 });
    expect((await remove(support, id, mediaIds[0]!)).statusCode).toBe(403);
    expect((await remove(moderator, id, mediaIds[0]!, {})).statusCode).toBe(400);
    const short = await remove(moderator, id, mediaIds[0]!, { reason: 'no' });
    expect(short.statusCode).toBe(400);
    expect(short.json().details).toMatchObject({ field: 'reason' });
    expect(await mediaRow(mediaIds[0]!)).toBeDefined();
    expect(await auditsOf(id)).toHaveLength(0);
    expect(deletePublic).not.toHaveBeenCalled();
  });

  it('an unknown listing → 404 LISTING_NOT_FOUND; a media id of another listing → 404 MEDIA_NOT_FOUND', async () => {
    const { mediaIds } = await listingOf({ photos: 1 });
    const other = await listingOf({ photos: 2 });
    const unknown = await remove(moderator, randomUUID(), mediaIds[0]!);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('LISTING_NOT_FOUND');
    const wrong = await remove(moderator, other.id, mediaIds[0]!);
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().code).toBe('MEDIA_NOT_FOUND');
    expect(await mediaRow(mediaIds[0]!)).toBeDefined();
  });

  it('without media storage → 503 STORAGE_UNAVAILABLE and the row stays', async () => {
    const { id, mediaIds } = await listingOf({ photos: 2 });
    process.env.AWS_S3_PUBLIC_BUCKET = '';
    const res = await remove(moderator, id, mediaIds[0]!);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('STORAGE_UNAVAILABLE');
    expect(await mediaRow(mediaIds[0]!)).toBeDefined();
  });
});
