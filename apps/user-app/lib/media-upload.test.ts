import { describe, expect, it, vi } from 'vitest';
import type { ListingMediaItem, MediaPresignRequest, MediaPresignResult } from '@mpm/shared-types';
import {
  attachRequest, nextToUpload, pendingCount, presignRequest, runUpload, uploadReducer, type UploadAction, type UploadIO,
  type UploadItem,
} from './media-upload';

const photo = (localId = 'p1') => ({
  localId,
  type: 'photo' as const,
  files: [
    { role: 'full' as const, uri: 'file:///full.jpg', contentType: 'image/jpeg', size: 300 },
    { role: 'thumb' as const, uri: 'file:///thumb.jpg', contentType: 'image/jpeg', size: 100 },
  ],
  durationMs: null,
  previewUri: 'file:///thumb.jpg',
});

const media: ListingMediaItem = {
  id: 'm1', type: 'photo', url: 'u', thumbUrl: 't', contentType: 'image/jpeg', sizeBytes: 300, durationMs: null, sortOrder: 0,
};

const presigned = (uploadId: string): MediaPresignResult => ({
  uploadId,
  files: [
    { role: 'full', key: `k/${uploadId}/full.jpg`, url: `https://put/${uploadId}/full`, expiresAt: 'x' },
    { role: 'thumb', key: `k/${uploadId}/thumb.jpg`, url: `https://put/${uploadId}/thumb`, expiresAt: 'x' },
  ],
});

/** Runs the reducer as the hook would. */
function store(initial: UploadItem[] = []) {
  let state = initial;
  const dispatch = (a: UploadAction) => { state = uploadReducer(state, a); };
  return { dispatch, get: () => state };
}

describe('uploadReducer', () => {
  it('adds queued items and runs one at a time', () => {
    const s = store();
    s.dispatch({ type: 'add', items: [photo('a'), photo('b')] });
    expect(s.get().map((i) => i.status)).toEqual(['queued', 'queued']);
    expect(nextToUpload(s.get())?.localId).toBe('a');
    s.dispatch({ type: 'start', localId: 'a' });
    expect(nextToUpload(s.get())).toBeNull();
    expect(pendingCount(s.get(), 'photo')).toBe(2);
  });
  it('retry puts a failed item back in the queue with its uploadId', () => {
    const s = store();
    s.dispatch({ type: 'add', items: [photo()] });
    s.dispatch({ type: 'start', localId: 'p1' });
    s.dispatch({ type: 'presigned', localId: 'p1', uploadId: 'u1' });
    s.dispatch({ type: 'failed', localId: 'p1', code: 'UPLOAD_FAILED' });
    expect(s.get()[0]).toMatchObject({ status: 'failed', errorCode: 'UPLOAD_FAILED', uploadId: 'u1', attempts: 1 });
    s.dispatch({ type: 'retry', localId: 'p1' });
    expect(s.get()[0]).toMatchObject({ status: 'queued', errorCode: null, uploadId: 'u1' });
    expect(presignRequest(s.get()[0]!)).toEqual({
      type: 'photo', uploadId: 'u1',
      files: [{ role: 'full', contentType: 'image/jpeg', size: 300 }, { role: 'thumb', contentType: 'image/jpeg', size: 100 }],
    });
  });
  it('remove and clearDone', () => {
    const s = store();
    s.dispatch({ type: 'add', items: [photo('a'), photo('b')] });
    s.dispatch({ type: 'done', localId: 'a', media });
    expect(pendingCount(s.get(), 'photo')).toBe(1);
    s.dispatch({ type: 'clearDone' });
    expect(s.get().map((i) => i.localId)).toEqual(['b']);
    s.dispatch({ type: 'remove', localId: 'b' });
    expect(s.get()).toEqual([]);
  });
});

describe('runUpload', () => {
  it('presign → PUT each file with progress → attach', async () => {
    const s = store();
    s.dispatch({ type: 'add', items: [photo()] });
    const progress: number[] = [];
    const io: UploadIO = {
      presign: vi.fn(async () => presigned('u1')),
      put: vi.fn(async (_url, file, onProgress) => { onProgress(file.size, file.size); }),
      attach: vi.fn(async () => media),
    };
    const result = await runUpload(s.get()[0]!, io, (a) => {
      s.dispatch(a);
      if (a.type === 'progress') progress.push(a.progress);
    });
    expect(result).toEqual({ ok: true, media });
    expect(io.put).toHaveBeenNthCalledWith(1, 'https://put/u1/full', expect.objectContaining({ role: 'full' }), expect.any(Function));
    expect(io.attach).toHaveBeenCalledWith({ type: 'photo', uploadId: 'u1', keys: { full: 'k/u1/full.jpg', thumb: 'k/u1/thumb.jpg' } });
    expect(progress).toEqual([0.75, 1]);
    expect(s.get()[0]).toMatchObject({ status: 'done', media });
  });

  it('re-presigns on retry with the same uploadId', async () => {
    const s = store();
    s.dispatch({ type: 'add', items: [photo()] });
    const requests: MediaPresignRequest[] = [];
    let puts = 0;
    const io: UploadIO = {
      presign: vi.fn(async (req: MediaPresignRequest) => { requests.push(req); return presigned(req.uploadId ?? 'u1'); }),
      put: vi.fn(async () => {
        puts += 1;
        if (puts === 1) throw Object.assign(new Error('put 403'), { code: 'UPLOAD_FAILED' });
      }),
      attach: vi.fn(async () => media),
    };
    const first = await runUpload(s.get()[0]!, io, s.dispatch);
    expect(first).toEqual({ ok: false, code: 'UPLOAD_FAILED' });
    expect(s.get()[0]).toMatchObject({ status: 'failed', uploadId: 'u1' });

    s.dispatch({ type: 'retry', localId: 'p1' });
    const item = nextToUpload(s.get())!;
    const second = await runUpload(item, io, s.dispatch);
    expect(second.ok).toBe(true);
    expect(io.presign).toHaveBeenCalledTimes(2);
    expect(requests[0]!.uploadId).toBeUndefined();
    expect(requests[1]!.uploadId).toBe('u1');
    expect(s.get()[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('an API error on attach fails the item with its code', async () => {
    const s = store();
    s.dispatch({ type: 'add', items: [photo()] });
    const io: UploadIO = {
      presign: async () => presigned('u1'),
      put: async () => {},
      attach: async () => { throw { response: { status: 400, data: { code: 'MEDIA_METADATA' } } }; },
    };
    expect(await runUpload(s.get()[0]!, io, s.dispatch)).toEqual({ ok: false, code: 'MEDIA_METADATA' });
  });

  it('a video attach carries its duration', () => {
    const req = attachRequest({ type: 'video', durationMs: 42_000 }, {
      uploadId: 'v1',
      files: [
        { role: 'video', key: 'kv', url: 'x', expiresAt: 'x' },
        { role: 'poster', key: 'kp', url: 'x', expiresAt: 'x' },
      ],
    });
    expect(req).toEqual({ type: 'video', uploadId: 'v1', keys: { video: 'kv', poster: 'kp' }, durationMs: 42_000 });
  });
});
