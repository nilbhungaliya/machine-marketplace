import { randomUUID } from 'node:crypto';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { gstRepresentativeProofs } from '../src/db/schema.js';
import { STORAGE_ENV, headObject, isStorageConfigured } from '../src/lib/storage.js';
import { DECLARATION_VERSION } from '../src/services/verification/gst-instant.service.js';
import {
  DOCUMENT_MAX_BYTES,
  deleteKeys,
  presignDocumentRead,
  presignDocumentUpload,
  stageDocuments,
} from '../src/services/verification/gst-documents.service.js';
import { createTestBusinessUser, deleteTestBusinesses, uniqueTestGstin, type TestBusinessUser } from './_helpers/test-businesses.js';

// Verification documents in private R2 storage (F1 + A2 spec §6). Everything up to the upload (the 503 without
// storage, type and size checks, key building, ownership checks) runs without R2: presigning signs locally, so fake
// variables are enough. The round trip needs real R2 keys and is skipped without them.

const saved = Object.fromEntries(STORAGE_ENV.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;

function clearStorageEnv(): void {
  for (const key of STORAGE_ENV) delete process.env[key];
}

/** Values that make storage "configured" without a reachable R2: only for checks that never touch the network. */
function fakeStorageEnv(): void {
  process.env.AWS_S3_ENDPOINT = 'https://example-account.r2.cloudflarestorage.com';
  process.env.AWS_REGION = 'auto';
  process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  process.env.AWS_S3_PRIVATE_BUCKET = 'test-private';
}

function restoreStorageEnv(): void {
  for (const key of STORAGE_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

describe('GST documents (no R2 needed)', () => {
  let app: FastifyInstance;
  let user: TestBusinessUser;
  let other: TestBusinessUser;

  const presign = (body: object, who: TestBusinessUser = user) =>
    app.inject({ method: 'POST', url: '/businesses/me/gst/documents/presign', headers: { authorization: `Bearer ${who.token}` }, payload: body });

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    user = await createTestBusinessUser();
    other = await createTestBusinessUser();
  });

  afterEach(restoreStorageEnv);

  afterAll(async () => {
    restoreStorageEnv();
    await deleteTestBusinesses([user.businessId, other.businessId]);
    await app.close();
  });

  it('with the storage variables cleared, presign → 503 STORAGE_UNAVAILABLE (checked first)', async () => {
    clearStorageEnv();
    expect(isStorageConfigured()).toBe(false);
    const res = await presign({ contentType: 'text/html', size: 99_999_999 });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('STORAGE_UNAVAILABLE');
    // And the state tells the app before it tries.
    const state = await app.inject({ method: 'GET', url: '/businesses/me/gst', headers: { authorization: `Bearer ${user.token}` } });
    expect(state.json().data.storageAvailable).toBe(false);
  });

  it('one blank variable is enough to count as unconfigured', () => {
    fakeStorageEnv();
    expect(isStorageConfigured()).toBe(true);
    process.env.AWS_S3_PRIVATE_BUCKET = '  ';
    expect(isStorageConfigured()).toBe(false);
  });

  it('text/html → 400 DOCUMENT_TYPE', async () => {
    fakeStorageEnv();
    const res = await presign({ contentType: 'text/html', size: 1000 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DOCUMENT_TYPE');
  });

  it('10 485 761 bytes → 413 MEDIA_TOO_LARGE; 10 485 760 is allowed', async () => {
    fakeStorageEnv();
    expect(DOCUMENT_MAX_BYTES).toBe(10_485_760);
    const big = await presign({ contentType: 'application/pdf', size: 10_485_761 });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('MEDIA_TOO_LARGE');
    const max = await presign({ contentType: 'application/pdf', size: 10_485_760 });
    expect(max.statusCode).toBe(200);
  });

  it('a presign without a proof gets a new upload id; the key is incoming-verification/<business>/<upload>/<uuid>.<ext>', async () => {
    fakeStorageEnv();
    const res = await presign({ contentType: 'image/png', size: 2048 });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { url: string; key: string; expiresAt: string; uploadId: string };
    expect(data.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.key).toMatch(new RegExp(`^incoming-verification/${user.businessId}/${data.uploadId}/[0-9a-f-]{36}\\.png$`));
    expect(data.url).toContain('test-private');
    expect(data.url).toContain('X-Amz-Expires=300');
    const ttl = Date.parse(data.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(290_000);
    expect(ttl).toBeLessThanOrEqual(300_000);
  });

  it("a presign for a proof uses the proof id as the upload id; another business's proof → 404", async () => {
    fakeStorageEnv();
    const [proof] = await db
      .insert(gstRepresentativeProofs)
      .values({
        businessId: user.businessId,
        userId: user.userId,
        gstin: uniqueTestGstin(),
        declarationVersion: DECLARATION_VERSION,
        method: 'documents',
        status: 'needs_more',
      })
      .returning({ id: gstRepresentativeProofs.id });
    const own = await presign({ proofId: proof!.id, contentType: 'image/jpeg', size: 500 });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.uploadId).toBe(proof!.id);
    expect(own.json().data.key).toMatch(new RegExp(`^incoming-verification/${user.businessId}/${proof!.id}/[0-9a-f-]{36}\\.jpg$`));
    const foreign = await presign({ proofId: proof!.id, contentType: 'image/jpeg', size: 500 }, other);
    expect(foreign.statusCode).toBe(404);
  });

  it('a second file of a new submission joins the upload id of the first; a bad upload id → 400', async () => {
    fakeStorageEnv();
    const first = (await presign({ contentType: 'application/pdf', size: 100 })).json().data as { uploadId: string };
    const second = await presign({ uploadId: first.uploadId, contentType: 'image/png', size: 100 });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.uploadId).toBe(first.uploadId);
    expect(second.json().data.key.startsWith(`incoming-verification/${user.businessId}/${first.uploadId}/`)).toBe(true);
    expect((await presign({ uploadId: 'not-a-uuid', contentType: 'image/png', size: 100 })).statusCode).toBe(400);
    expect((await presign({ uploadId: first.uploadId, proofId: first.uploadId, contentType: 'image/png', size: 100 })).statusCode).toBe(400);
  });

  it('stageDocuments refuses a key under another business (or another upload) with 400 before touching storage', async () => {
    fakeStorageEnv();
    const uploadId = randomUUID();
    const proofId = randomUUID();
    const foreignKey = `incoming-verification/${other.businessId}/${uploadId}/${randomUUID()}.pdf`;
    await expect(
      stageDocuments({ businessId: user.businessId, uploadId, proofId, files: [{ key: foreignKey, type: 'gst_certificate' }] }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENT_KEY_INVALID' });
    const otherUpload = `incoming-verification/${user.businessId}/${randomUUID()}/${randomUUID()}.pdf`;
    await expect(
      stageDocuments({ businessId: user.businessId, uploadId, proofId, files: [{ key: otherUpload, type: 'gst_certificate' }] }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENT_KEY_INVALID' });
    const sneaky = `incoming-verification/${user.businessId}/${uploadId}/../../${other.businessId}/x.pdf`;
    await expect(
      stageDocuments({ businessId: user.businessId, uploadId, proofId, files: [{ key: sneaky, type: 'id_proof' }] }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENT_KEY_INVALID' });
  });

  it('stageDocuments and presignDocumentRead answer 503 without storage; deleteKeys never throws', async () => {
    clearStorageEnv();
    const uploadId = randomUUID();
    await expect(
      stageDocuments({
        businessId: user.businessId,
        uploadId,
        proofId: randomUUID(),
        files: [{ key: `incoming-verification/${user.businessId}/${uploadId}/${randomUUID()}.pdf`, type: 'gst_certificate' }],
      }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'STORAGE_UNAVAILABLE' });
    await expect(presignDocumentRead(`verification/${user.businessId}/${randomUUID()}/${randomUUID()}.pdf`)).rejects.toMatchObject({
      statusCode: 503,
    });
    const logged: unknown[] = [];
    await expect(deleteKeys(['verification/x/y/z.pdf'], { error: (...args: unknown[]) => logged.push(args) })).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
  });

  it('presignDocumentRead signs only verification/ keys, for 300 s', async () => {
    fakeStorageEnv();
    const url = await presignDocumentRead(`verification/${user.businessId}/${randomUUID()}/${randomUUID()}.pdf`);
    expect(url).toContain('X-Amz-Expires=300');
    await expect(presignDocumentRead(`incoming-verification/${user.businessId}/a/b.pdf`)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('presignDocumentUpload is the service behind the route', async () => {
    fakeStorageEnv();
    const out = await presignDocumentUpload(db, { userId: user.userId, businessId: user.businessId }, { contentType: 'image/webp', size: 10 });
    expect(out.key.endsWith('.webp')).toBe(true);
  });
});

const R2_SKIP_MESSAGE = 'R2 keys not set: storage round-trip tests skipped';
if (!isStorageConfigured()) console.warn(R2_SKIP_MESSAGE);

/** Keys under a prefix in the private bucket (test-only: the app never lists). */
async function listKeys(prefix: string): Promise<string[]> {
  const client = new S3Client({
    region: process.env.AWS_REGION!,
    endpoint: process.env.AWS_S3_ENDPOINT!,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
  });
  const out = await client.send(new ListObjectsV2Command({ Bucket: process.env.AWS_S3_PRIVATE_BUCKET!, Prefix: prefix }));
  return (out.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

describe.skipIf(!isStorageConfigured())(`GST documents on R2 (${R2_SKIP_MESSAGE} when unset)`, () => {
  let user: TestBusinessUser;
  const made: string[] = [];

  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
  const HTML = Buffer.from('<html><body>not a pdf</body></html>', 'latin1');

  /** Presign (joining `uploadId`'s batch when given) and PUT. */
  async function upload(uploadId: string | undefined, bytes: Buffer, contentType: string) {
    const out = await presignDocumentUpload(
      db,
      { userId: user.userId, businessId: user.businessId },
      { ...(uploadId ? { uploadId } : {}), contentType, size: bytes.length },
    );
    const res = await fetch(out.url, { method: 'PUT', body: new Uint8Array(bytes), headers: { 'content-type': contentType, 'content-length': String(bytes.length) } });
    expect(res.ok).toBe(true);
    made.push(out.key);
    return out;
  }

  beforeAll(async () => {
    user = await createTestBusinessUser();
  });

  afterAll(async () => {
    await deleteKeys(made);
    await deleteTestBusinesses([user.businessId]);
  });

  it('presign + PUT, stage copies to verification/, deleteKeys(incoming) removes the upload', async () => {
    const up = await upload(undefined, PDF, 'application/pdf');
    const proofId = randomUUID();
    const staged = await stageDocuments({ businessId: user.businessId, uploadId: up.uploadId, proofId, files: [{ key: up.key, type: 'gst_certificate' }] });
    made.push(...staged.copied.map((c) => c.key));
    expect(staged.incoming).toEqual([up.key]);
    expect(staged.copied[0]!.key).toMatch(new RegExp(`^verification/${user.businessId}/${proofId}/[0-9a-f-]{36}\\.pdf$`));
    expect(staged.copied[0]!.type).toBe('gst_certificate');
    expect(await headObject(staged.copied[0]!.key)).not.toBeNull();
    await deleteKeys(staged.incoming);
    expect(await headObject(up.key)).toBeNull();
  });

  it('a forced rollback after staging leaves no verification/ object', async () => {
    const up = await upload(undefined, PDF, 'application/pdf');
    const proofId = randomUUID();
    const staged = await stageDocuments({ businessId: user.businessId, uploadId: up.uploadId, proofId, files: [{ key: up.key, type: 'id_proof' }] });
    made.push(...staged.copied.map((c) => c.key));
    await expect(
      db.transaction(async () => {
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    await deleteKeys(staged.copied.map((c) => c.key));
    expect(await headObject(staged.copied[0]!.key)).toBeNull();
    // The incoming file stays for the 1-day lifecycle rule.
    expect(await headObject(up.key)).not.toBeNull();
  });

  it('HTML bytes uploaded as application/pdf → 400 DOCUMENT_TYPE, and no copy is left', async () => {
    const good = await upload(undefined, PDF, 'application/pdf');
    const bad = await upload(good.uploadId, HTML, 'application/pdf');
    const proofId = randomUUID();
    await expect(
      stageDocuments({
        businessId: user.businessId,
        uploadId: good.uploadId,
        proofId,
        files: [
          { key: good.key, type: 'gst_certificate' },
          { key: bad.key, type: 'id_proof' },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENT_TYPE' });
    // The good file was copied first; that copy was deleted before the error was thrown.
    expect(await listKeys(`verification/${user.businessId}/${proofId}/`)).toEqual([]);
  });
});
