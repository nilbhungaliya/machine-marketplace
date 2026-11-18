import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as LegacyFS from 'expo-file-system/legacy';
import { Video, getVideoMetaData } from 'react-native-compressor';
import { errorCode } from './api-error';
import {
  contentTypeFor, PHOTO_TARGETS, POSTER_TARGET, resizeAction, sizeProblem, VIDEO_COMPRESS_OPTIONS,
  videoDurationProblem,
} from './media-prepare';
import type { PreparedFile, UploadIO } from './media-upload';
import { attachMedia, presignMedia } from './listing-api';

// The native half of the media step (F2 spec §6.4, §6.5; plan Tasks 20, 21, 24): the manipulator for every photo and
// poster, the compressor for video, the poster frame, the size of a file, and the binary PUT with progress. Not unit
// tested (native modules); the rules it applies are in `media-prepare.ts` (tested). Errors carry a `code` that
// `lib/listing-errors.ts` maps: `PHOTO_PREPARE_FAILED`, `VIDEO_PREPARE_FAILED`, `VIDEO_TOO_LONG`, `MEDIA_TOO_LARGE`,
// `UPLOAD_FAILED`.

const coded = (code: string, cause?: unknown) => Object.assign(new Error(code), { code, cause });

/** The size of a local file in bytes (0 when it can't be read). */
export async function fileSize(uri: string): Promise<number> {
  const info = await LegacyFS.getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

/** One manipulator pass: resized to `longEdge` when larger, re-encoded as JPEG (which writes no EXIF, R46). */
async function toJpeg(uri: string, longEdge: number, compress: number, size?: { width: number; height: number }) {
  const ctx = ImageManipulator.manipulate(uri);
  let width = size?.width ?? 0;
  let height = size?.height ?? 0;
  if (!(width > 0 && height > 0)) {
    const probe = await ctx.renderAsync();
    width = probe.width;
    height = probe.height;
    ctx.reset();
  }
  const resize = resizeAction(width, height, longEdge);
  if (resize) ctx.resize(resize);
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress, format: SaveFormat.JPEG });
  return out.uri;
}

async function prepared(role: PreparedFile['role'], uri: string): Promise<PreparedFile> {
  const size = await fileSize(uri);
  if (sizeProblem(role, size)) throw coded('MEDIA_TOO_LARGE');
  return { role, uri, contentType: contentTypeFor(role, uri), size };
}

/**
 * A picked photo → `full` (1600 px, 0.8) and `thumb` (480 px, 0.7) JPEGs from the manipulator. There is no raw
 * fallback: a failure throws `PHOTO_PREPARE_FAILED` ("Couldn't prepare this photo. Try another.").
 */
export async function preparePhoto(uri: string, size?: { width: number; height: number }): Promise<PreparedFile[]> {
  try {
    const full = await toJpeg(uri, PHOTO_TARGETS.full.longEdge, PHOTO_TARGETS.full.compress, size);
    const thumb = await toJpeg(full, PHOTO_TARGETS.thumb.longEdge, PHOTO_TARGETS.thumb.compress);
    return [await prepared('full', full), await prepared('thumb', thumb)];
  } catch (err) {
    if (errorCode(err) === 'MEDIA_TOO_LARGE') throw err;
    throw coded('PHOTO_PREPARE_FAILED', err);
  }
}

/**
 * A picked video → the compressed MP4 (`preserveMetadata: false`, R47), its duration rechecked on the output, and a
 * poster frame at 1 s through the manipulator. Only call this when `videoUploadEnabled()`.
 */
export async function prepareVideo(uri: string, pickerDurationMs: number | null): Promise<{ files: PreparedFile[]; durationMs: number }> {
  if (videoDurationProblem(pickerDurationMs)) throw coded('VIDEO_TOO_LONG');
  let out: string;
  let durationMs: number;
  try {
    out = await Video.compress(uri, { ...VIDEO_COMPRESS_OPTIONS });
    const meta = await getVideoMetaData(out);
    // The library reports seconds.
    durationMs = Math.round(Number(meta.duration) * 1000);
  } catch (err) {
    throw coded('VIDEO_PREPARE_FAILED', err);
  }
  if (!Number.isFinite(durationMs) || videoDurationProblem(durationMs)) throw coded('VIDEO_TOO_LONG');
  let posterUri: string;
  try {
    const frame = await VideoThumbnails.getThumbnailAsync(out, { time: POSTER_TARGET.atMs });
    posterUri = await toJpeg(frame.uri, POSTER_TARGET.longEdge, POSTER_TARGET.compress, { width: frame.width, height: frame.height });
  } catch (err) {
    throw coded('VIDEO_PREPARE_FAILED', err);
  }
  return { files: [await prepared('video', out), await prepared('poster', posterUri)], durationMs };
}

/** A binary PUT of a local file to a presigned URL, streamed from disk with progress (`createUploadTask`, §6.5). */
export async function putFile(url: string, file: PreparedFile, onProgress: (sent: number, total: number) => void): Promise<void> {
  const task = LegacyFS.createUploadTask(
    url,
    file.uri,
    {
      httpMethod: 'PUT',
      uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
      // Content-Type is part of the signature: exactly what was presigned.
      headers: { 'Content-Type': file.contentType },
    },
    (p) => onProgress(p.totalBytesSent, p.totalBytesExpectedToSend),
  );
  const res = await task.uploadAsync();
  if (!res || res.status < 200 || res.status >= 300) throw coded('UPLOAD_FAILED');
}

/** The upload queue's I/O for one listing (`runUpload` in `media-upload.ts`). */
export function listingUploadIO(listingId: string): UploadIO {
  return {
    presign: (req) => presignMedia(listingId, req),
    put: putFile,
    attach: (req) => attachMedia(listingId, req),
  };
}
