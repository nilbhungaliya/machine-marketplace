import { LISTING_VIDEO_UPLOAD_ENABLED } from '@mpm/shared-types';

/**
 * The API's video switch (F2 amendment 3, plan Task 13): off → presign and attach of `type: 'video'` answer
 * `400 MEDIA_TYPE`. Its own module so tests can `vi.mock` it (a `vi.spyOn` on an ESM export doesn't intercept calls made
 * inside the module that defines it): the video-path tests run with video on whatever the shared constant says.
 */
export function videoUploadEnabled(): boolean {
  return LISTING_VIDEO_UPLOAD_ENABLED;
}
