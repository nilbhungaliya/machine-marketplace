import { Platform } from 'react-native';
import {
  LISTING_PHOTOS_MAX, LISTING_VIDEO_MAX_MS, LISTING_VIDEO_UPLOAD_ENABLED, LISTING_VIDEOS_MAX, MEDIA_MAX_BYTES,
  type MediaRole, type MediaType,
} from '@mpm/shared-types';

// What the device does to media before upload (F2 spec §6.3–§6.5, R46, R47; plan Tasks 20, 21): resize targets, the
// video switch, size / duration / count checks. Pure apart from `Platform.OS`; the native calls live in
// `lib/media-device.ts`.

/**
 * The native media spike's result in this build (plan Task 20, `docs/superpowers/spikes/2026-11-18-f2-native-media.md`).
 * `false` until the device checks pass: the compressor's output carries no `location` tag and the manipulator's no
 * EXIF, on Android. Video upload in the app needs this **and** the shared `LISTING_VIDEO_UPLOAD_ENABLED`.
 */
export const VIDEO_SPIKE_PASSED = false;

/** The switch as a pure function: the shared constant, this build's spike result, and Android only (iOS unverified). */
export function videoUploadAllowed(opts: { shared: boolean; spikePassed: boolean; os: string }): boolean {
  return opts.shared && opts.spikePassed && opts.os === 'android';
}

/**
 * Whether the media step offers video (amendment 3): `LISTING_VIDEO_UPLOAD_ENABLED`, the spike passed, and Android
 * (until the owner checklist verifies iOS, plan Task 30). Off → photos only.
 */
export function videoUploadEnabled(): boolean {
  return videoUploadAllowed({ shared: LISTING_VIDEO_UPLOAD_ENABLED, spikePassed: VIDEO_SPIKE_PASSED, os: Platform.OS });
}

/** Every photo goes through the manipulator (R46): a new JPEG, no EXIF. Long edge in px, JPEG quality 0–1. */
export const PHOTO_TARGETS = {
  full: { longEdge: 1600, compress: 0.8 },
  thumb: { longEdge: 480, compress: 0.7 },
} as const;

/** The video poster: a frame at 1 s, then through the manipulator to a ~720 px JPEG. */
export const POSTER_TARGET = { longEdge: 720, compress: 0.8, atMs: 1000 } as const;

/** `Video.compress` options (R47): H.264 MP4 ~720p, the source's metadata (GPS) never copied. */
export const VIDEO_COMPRESS_OPTIONS = { compressionMethod: 'auto', maxSize: 1280, preserveMetadata: false } as const;

/** The camera opens with this cap (seconds). */
export const CAMERA_VIDEO_MAX_SECONDS = 60;

/**
 * The manipulator's resize action for a long edge: `{ width }` for landscape, `{ height }` for portrait (the other
 * side keeps the ratio), or null when the image is already that small (it is still re-encoded, which drops EXIF).
 */
export function resizeAction(width: number, height: number, longEdge: number): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return { width: longEdge };
  if (Math.max(width, height) <= longEdge) return null;
  return width >= height ? { width: longEdge } : { height: longEdge };
}

export type MediaProblem = 'photoLimit' | 'videoLimit' | 'videoTooLong' | 'tooLarge' | 'videoOff';

/** i18n keys of the problems (`sell.media.*`). */
export const MEDIA_PROBLEM_KEYS: Record<MediaProblem, string> = {
  photoLimit: 'sell.media.photoLimit',
  videoLimit: 'sell.media.videoLimit',
  videoTooLong: 'sell.media.videoTooLong',
  tooLarge: 'sell.media.tooLarge',
  videoOff: 'sell.media.videoLimit',
};

const MAX: Record<MediaType, number> = { photo: LISTING_PHOTOS_MAX, video: LISTING_VIDEOS_MAX };

/** How many more of a type can be added, counting attached items and those still in the upload queue. */
export function remainingSlots(type: MediaType, attached: number, queued = 0): number {
  return Math.max(0, MAX[type] - attached - queued);
}

/**
 * Adding `count` items of `type`: how many fit (the picker's `selectionLimit` is `remainingSlots`, but a camera shot
 * or a stale count can still overflow) and the problem to show for the rest.
 */
export function checkAdd(type: MediaType, count: number, attached: number, queued = 0): { accepted: number; problem: MediaProblem | null } {
  const room = remainingSlots(type, attached, queued);
  if (count <= room) return { accepted: count, problem: null };
  return { accepted: room, problem: type === 'photo' ? 'photoLimit' : 'videoLimit' };
}

/**
 * A video's duration check (§6.3), run on the picker's duration and again on the compressed file's: over 60.5 s is
 * refused; an unknown duration passes here (the compressed file's check must then have one).
 */
export function videoDurationProblem(ms: number | null | undefined): MediaProblem | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return ms > LISTING_VIDEO_MAX_MS ? 'videoTooLong' : null;
}

/** A prepared file over its role's cap (`full` 4 MB, `thumb` / `poster` 1 MB, `video` 50 MB). */
export function sizeProblem(role: MediaRole, bytes: number): MediaProblem | null {
  return bytes > MEDIA_MAX_BYTES[role] ? 'tooLarge' : null;
}

/** The `Content-Type` a prepared file is presigned and PUT with: JPEG for images, MP4 (or QuickTime for `.mov`) for video. */
export function contentTypeFor(role: MediaRole, uri: string): string {
  if (role !== 'video') return 'image/jpeg';
  return /\.mov$/i.test(uri) ? 'video/quicktime' : 'video/mp4';
}
