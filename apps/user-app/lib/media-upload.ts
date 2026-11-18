import type {
  ListingMediaItem, MediaAttachRequest, MediaPresignRequest, MediaPresignResult, MediaRole, MediaType,
} from '@mpm/shared-types';
import { errorCode } from './api-error';

// The media step's upload queue (F2 spec §6.2; plan Task 21): one item at a time, presign just before the item's
// PUTs, a re-presign with the same `uploadId` on retry (so a slow queue never meets an expired URL), then attach.
// A pure reducer plus a runner whose I/O is injected (`hooks/use-upload-queue.ts` wires the real calls).

/** A file ready to upload: out of the manipulator / compressor, with its measured size. */
export interface PreparedFile {
  role: MediaRole;
  uri: string;
  contentType: string;
  size: number;
}

export type UploadStatus = 'queued' | 'uploading' | 'attaching' | 'done' | 'failed';

export interface UploadItem {
  /** Device-side id (the tile's key) until the server's media id exists. */
  localId: string;
  type: MediaType;
  /** `full` + `thumb` for a photo, `video` + `poster` for a video. */
  files: PreparedFile[];
  durationMs: number | null;
  /** What the tile shows while uploading: the local thumb or poster. */
  previewUri: string;
  status: UploadStatus;
  /** 0–1 across the item's files. */
  progress: number;
  /** From the first presign; sent again on every retry. */
  uploadId: string | null;
  errorCode: string | null;
  attempts: number;
  media: ListingMediaItem | null;
}

export type NewUploadItem = Pick<UploadItem, 'localId' | 'type' | 'files' | 'durationMs' | 'previewUri'>;

export type UploadAction =
  | { type: 'add'; items: NewUploadItem[] }
  | { type: 'start'; localId: string }
  | { type: 'presigned'; localId: string; uploadId: string }
  | { type: 'progress'; localId: string; progress: number }
  | { type: 'attaching'; localId: string }
  | { type: 'done'; localId: string; media: ListingMediaItem }
  | { type: 'failed'; localId: string; code: string }
  | { type: 'retry'; localId: string }
  | { type: 'remove'; localId: string }
  | { type: 'clearDone' };

const patch = (state: UploadItem[], localId: string, change: (i: UploadItem) => Partial<UploadItem>): UploadItem[] =>
  state.map((i) => (i.localId === localId ? { ...i, ...change(i) } : i));

export function uploadReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case 'add':
      return [
        ...state,
        ...action.items.map((i): UploadItem => ({
          ...i, status: 'queued', progress: 0, uploadId: null, errorCode: null, attempts: 0, media: null,
        })),
      ];
    case 'start':
      return patch(state, action.localId, (i) => ({ status: 'uploading', progress: 0, errorCode: null, attempts: i.attempts + 1 }));
    case 'presigned':
      return patch(state, action.localId, () => ({ uploadId: action.uploadId }));
    case 'progress':
      return patch(state, action.localId, () => ({ progress: Math.min(1, Math.max(0, action.progress)) }));
    case 'attaching':
      return patch(state, action.localId, () => ({ status: 'attaching', progress: 1 }));
    case 'done':
      return patch(state, action.localId, () => ({ status: 'done', progress: 1, media: action.media }));
    case 'failed':
      return patch(state, action.localId, () => ({ status: 'failed', errorCode: action.code }));
    case 'retry':
      // Keeps `uploadId`: the next presign sends it, and the server signs fresh URLs under the same prefix.
      return patch(state, action.localId, (i) => (i.status === 'failed' ? { status: 'queued', progress: 0, errorCode: null } : {}));
    case 'remove':
      return state.filter((i) => i.localId !== action.localId);
    case 'clearDone':
      return state.filter((i) => i.status !== 'done');
  }
}

/** The item to upload next: the first queued one, and only while nothing is in flight (one at a time). */
export function nextToUpload(state: readonly UploadItem[]): UploadItem | null {
  if (state.some((i) => i.status === 'uploading' || i.status === 'attaching')) return null;
  return state.find((i) => i.status === 'queued') ?? null;
}

/** Items of a type still taking a slot (not yet attached): counted against the 10 photos / 2 videos. */
export function pendingCount(state: readonly UploadItem[], type: MediaType): number {
  return state.filter((i) => i.type === type && i.status !== 'done').length;
}

/** The presign body of an item; `uploadId` once it has one (a retry). */
export function presignRequest(item: Pick<UploadItem, 'type' | 'files' | 'uploadId'>): MediaPresignRequest {
  return {
    type: item.type,
    ...(item.uploadId ? { uploadId: item.uploadId } : {}),
    files: item.files.map((f) => ({ role: f.role, contentType: f.contentType, size: f.size })),
  };
}

/** The attach body after the PUTs: the keys the presign returned, by role. */
export function attachRequest(item: Pick<UploadItem, 'type' | 'durationMs'>, presigned: MediaPresignResult): MediaAttachRequest {
  const key = (role: MediaRole) => {
    const f = presigned.files.find((x) => x.role === role);
    if (!f) throw Object.assign(new Error(`presign_missing_${role}`), { code: 'MEDIA_KEY_INVALID' });
    return f.key;
  };
  if (item.type === 'photo') return { type: 'photo', uploadId: presigned.uploadId, keys: { full: key('full'), thumb: key('thumb') } };
  // The compressed file's duration is measured in `prepareVideo`; a video without one never reaches attach (no `0`).
  if (item.durationMs == null || !Number.isFinite(item.durationMs)) {
    throw Object.assign(new Error('video_duration_missing'), { code: 'VIDEO_PREPARE_FAILED' });
  }
  return {
    type: 'video', uploadId: presigned.uploadId, keys: { video: key('video'), poster: key('poster') }, durationMs: item.durationMs,
  };
}

export interface UploadIO {
  presign(req: MediaPresignRequest): Promise<MediaPresignResult>;
  /** A binary PUT of the file to the signed URL with exactly the presigned `Content-Type`; rejects on a non-2xx. */
  put(url: string, file: PreparedFile, onProgress: (sent: number, total: number) => void): Promise<void>;
  attach(req: MediaAttachRequest): Promise<ListingMediaItem>;
}

/**
 * Uploads one item: presign (with its `uploadId` on a retry) → PUT each file with progress → attach. Never throws: the
 * outcome is dispatched (`done` with the media item, or `failed` with the error code — the API's, axios's, or
 * `UPLOAD_FAILED` from the PUT).
 */
export async function runUpload(
  item: UploadItem, io: UploadIO, dispatch: (a: UploadAction) => void,
): Promise<{ ok: true; media: ListingMediaItem } | { ok: false; code: string }> {
  const { localId } = item;
  dispatch({ type: 'start', localId });
  try {
    const presigned = await io.presign(presignRequest(item));
    dispatch({ type: 'presigned', localId, uploadId: presigned.uploadId });
    const total = item.files.reduce((s, f) => s + f.size, 0) || 1;
    let before = 0;
    for (const file of item.files) {
      const target = presigned.files.find((f) => f.role === file.role);
      if (!target) throw Object.assign(new Error(`presign_missing_${file.role}`), { code: 'MEDIA_KEY_INVALID' });
      await io.put(target.url, file, (sent) => dispatch({ type: 'progress', localId, progress: (before + sent) / total }));
      before += file.size;
    }
    dispatch({ type: 'attaching', localId });
    const media = await io.attach(attachRequest(item, presigned));
    dispatch({ type: 'done', localId, media });
    return { ok: true, media };
  } catch (err) {
    const code = errorCode(err);
    dispatch({ type: 'failed', localId, code });
    return { ok: false, code };
  }
}

/** The states `MediaTile` draws. */
export type MediaTileState = 'done' | 'queued' | 'uploading' | 'failed';

/**
 * An upload item's status as a `MediaTile` state and bar progress. `attaching` (the files are up, the server is
 * checking them) draws as `uploading` with a full bar.
 */
export function tileState(item: Pick<UploadItem, 'status' | 'progress'>): { state: MediaTileState; progress: number } {
  switch (item.status) {
    case 'queued': return { state: 'queued', progress: 0 };
    case 'uploading': return { state: 'uploading', progress: item.progress };
    case 'attaching': return { state: 'uploading', progress: 1 };
    case 'failed': return { state: 'failed', progress: item.progress };
    case 'done': return { state: 'done', progress: 1 };
  }
}
