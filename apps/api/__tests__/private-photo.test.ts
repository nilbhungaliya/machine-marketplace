import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { CHAT_LIMITS } from '@mpm/shared-types';
import { jpegHeaderStatus } from '../src/lib/sniff-media.js';
import * as storage from '../src/lib/storage.js';
import { finalizePrivatePhotos, presignPrivatePhoto, reencodeToJpeg } from '../src/services/chat/private-photo.js';

// Chat and deal photos (F6 + F7 spec §6.8, R8; plan C0-3). Offline by default: the storage network calls are spies that
// fall through to the real ones, and the offline cases answer them. Under `R2_TESTS=1` with the private keys set, a real
// presign → PUT → finalize round trip runs too.

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return {
    ...real,
    getObjectBytes: vi.fn(real.getObjectBytes),
    putPrivateObject: vi.fn(real.putPrivateObject),
    deleteObject: vi.fn(real.deleteObject),
    presignSignedPut: vi.fn(real.presignSignedPut),
  };
});

const bytesSpy = vi.mocked(storage.getObjectBytes);
const putSpy = vi.mocked(storage.putPrivateObject);
const deleteSpy = vi.mocked(storage.deleteObject);

const businessId = randomUUID();
const dest = { kind: 'chat' as const, threadId: randomUUID() };
const uploadKey = () => `incoming-chat/${businessId}/${randomUUID()}`;

const real = await vi.importActual<typeof import('../src/lib/storage.js')>('../src/lib/storage.js');

// Vitest 1's mockReset leaves an empty implementation: put the real one back for the R2 round trip.
afterEach(() => {
  bytesSpy.mockReset().mockImplementation(real.getObjectBytes);
  putSpy.mockReset().mockImplementation(real.putPrivateObject);
  deleteSpy.mockReset().mockImplementation(real.deleteObject);
});

function offline(bytes: Buffer): void {
  bytesSpy.mockResolvedValue(bytes);
  putSpy.mockResolvedValue(undefined);
  deleteSpy.mockResolvedValue(undefined);
}

describe('reencodeToJpeg', () => {
  it('drops EXIF with GPS', async () => {
    const withGps = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#8080ff' } })
      .withMetadata({ exif: { IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '21/1 10/1 0/1' } } })
      .jpeg()
      .toBuffer();
    expect(jpegHeaderStatus(withGps)).toBe('exif');
    const out = await reencodeToJpeg(withGps);
    expect(jpegHeaderStatus(out)).toBe('clean');
    expect(out.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
  });

  it('shrinks a 4 000 px PNG to a JPEG with a long edge of 2 048 px', async () => {
    const png = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const out = await reencodeToJpeg(png);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);
  });
});

describe('finalizePrivatePhotos (offline)', () => {
  it('turns a WebP upload into a JPEG under chat/<threadId>/ and deletes the upload', async () => {
    const webp = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#00ff00' } }).webp().toBuffer();
    offline(webp);
    const key = uploadKey();
    const [final] = await finalizePrivatePhotos(businessId, [key], dest);
    expect(final).toMatch(new RegExp(`^chat/${dest.threadId}/[0-9a-f-]{36}\\.jpg$`));
    const written = putSpy.mock.calls[0]!;
    expect(written[2]).toBe('image/jpeg');
    expect((await sharp(written[1]).metadata()).format).toBe('jpeg');
    expect(deleteSpy).toHaveBeenCalledWith(key);
  });

  it('refuses random bytes with PHOTO_INVALID and writes nothing', async () => {
    offline(Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 256)));
    await expect(finalizePrivatePhotos(businessId, [uploadKey()], dest)).rejects.toMatchObject({ statusCode: 400, code: 'PHOTO_INVALID' });
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('refuses a key under another business with PHOTO_KEY_INVALID before any storage call', async () => {
    offline(Buffer.alloc(0));
    const foreign = `incoming-chat/${randomUUID()}/${randomUUID()}`;
    await expect(finalizePrivatePhotos(businessId, [foreign], dest)).rejects.toMatchObject({ statusCode: 400, code: 'PHOTO_KEY_INVALID' });
    expect(bytesSpy).not.toHaveBeenCalled();
  });

  it('refuses more than photosPerMessage keys with TOO_MANY_PHOTOS before any storage call', async () => {
    offline(Buffer.alloc(0));
    const keys = Array.from({ length: CHAT_LIMITS.photosPerMessage + 1 }, () => uploadKey());
    await expect(finalizePrivatePhotos(businessId, keys, dest)).rejects.toMatchObject({ statusCode: 400, code: 'TOO_MANY_PHOTOS' });
    expect(bytesSpy).not.toHaveBeenCalled();
  });
});

describe.runIf(process.env.R2_TESTS === '1' && storage.isStorageConfigured())('finalizePrivatePhotos (R2)', () => {
  it('presign → PUT → finalize; the upload is gone and a second finalize is PHOTO_KEY_INVALID', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    const { url, key } = await presignPrivatePhoto(businessId, 'image/jpeg', jpeg.length);
    const put = await fetch(url, { method: 'PUT', body: new Uint8Array(jpeg), headers: { 'content-type': 'image/jpeg' } });
    expect(put.status).toBe(200);
    const [final] = await finalizePrivatePhotos(businessId, [key], dest);
    try {
      expect(await storage.getObjectBytes(key)).toBeNull();
      await expect(finalizePrivatePhotos(businessId, [key], dest)).rejects.toMatchObject({ code: 'PHOTO_KEY_INVALID' });
    } finally {
      await storage.deleteObject(final!);
    }
  });
});
