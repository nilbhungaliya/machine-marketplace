import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { purgeUrls } from '../src/lib/cdn-purge.js';
import { publicUrl } from '../src/lib/media-url.js';
import {
  PUBLIC_MEDIA_CACHE_CONTROL,
  copyToPublic,
  deleteObject,
  deletePublicObject,
  presignSignedPut,
} from '../src/lib/storage.js';
import { r2TestsEnabled, restoreR2Env } from './_helpers/r2-env.js';

// The R2 spike (F2 plan Task 11): does a cross-bucket CopyObject with `MetadataDirective: 'REPLACE'` really serve the
// replaced `Content-Type` and `Cache-Control` from the public URL, with range requests? Real R2 only, behind
// `R2_TESTS=1`. If R2 ignores REPLACE (the upload's headers come back), stop: the named fallback is a Cloudflare Cache /
// Transform Rule on the media hostname for `Cache-Control`, with the content type fixed by the presign's signed
// `Content-Type` (owner decides before media continues).

const enabled = r2TestsEnabled();

// A tiny JPEG-looking body (the copy doesn't care what it is).
const BODY = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0spike-test-body-0123456789', 'latin1')]);

const incoming = `incoming-listing/spike/${randomUUID()}.jpg`;
const target = `listings/spike/${randomUUID()}/full.jpg`;

afterAll(async () => {
  if (enabled) {
    await deleteObject(incoming).catch(() => undefined);
    await deletePublicObject(target).catch(() => undefined);
  }
  restoreR2Env();
});

describe.skipIf(!enabled)('R2 spike: private → public copy with replaced metadata', () => {
  it('serves the replaced Content-Type and Cache-Control, answers a range with 206, and deletes', async () => {
    // Uploaded with a type different from what the copy sets.
    const put = await presignSignedPut(incoming, 'application/octet-stream', BODY.length);
    const res = await fetch(put.url, { method: 'PUT', body: BODY, headers: { 'content-type': 'application/octet-stream' } });
    expect(res.status, await res.text()).toBe(200);

    await copyToPublic(incoming, target, { contentType: 'image/jpeg' });
    const url = publicUrl(target)!;
    const got = await fetch(url);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type'), 'R2 ignored MetadataDirective REPLACE: stop and report (see the header comment)').toBe('image/jpeg');
    expect(got.headers.get('cache-control')).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
    expect(Buffer.from(await got.arrayBuffer()).equals(BODY)).toBe(true);

    const ranged = await fetch(url, { headers: { range: 'bytes=0-9' } });
    expect(ranged.status).toBe(206);
    expect(Buffer.from(await ranged.arrayBuffer()).length).toBe(10);

    await deleteObject(incoming);
    await deletePublicObject(target);
    if ((process.env.CLOUDFLARE_ZONE_ID ?? '').trim()) {
      // Behind the CDN the edge may still hold the copy until the purge has spread, so only the purge is checked.
      expect(await purgeUrls([url])).toBe('ok');
    } else {
      expect((await fetch(url)).status).toBe(404);
    }
  });
});
