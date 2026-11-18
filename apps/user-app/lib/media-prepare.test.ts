import { describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
vi.mock('react-native', () => ({ Platform: platform }));

import { i18n } from '@/lib/i18n';
import {
  checkAdd, contentTypeFor, MEDIA_PROBLEM_KEYS, remainingSlots, resizeAction, sizeProblem, VIDEO_SPIKE_PASSED,
  videoDurationProblem, videoUploadAllowed, videoUploadEnabled,
} from './media-prepare';

describe('video switch', () => {
  it('videoUploadEnabled() is false on ios', () => {
    platform.OS = 'ios';
    expect(videoUploadEnabled()).toBe(false);
  });
  it('is off in this build until the spike passes (plan Task 20)', () => {
    platform.OS = 'android';
    expect(VIDEO_SPIKE_PASSED).toBe(false);
    expect(videoUploadEnabled()).toBe(false);
  });
  it('needs the shared flag, the spike and Android', () => {
    expect(videoUploadAllowed({ shared: true, spikePassed: true, os: 'android' })).toBe(true);
    expect(videoUploadAllowed({ shared: true, spikePassed: true, os: 'ios' })).toBe(false);
    expect(videoUploadAllowed({ shared: false, spikePassed: true, os: 'android' })).toBe(false);
    expect(videoUploadAllowed({ shared: true, spikePassed: false, os: 'android' })).toBe(false);
  });
});

describe('counts', () => {
  it('refuses an 11th photo', () => {
    expect(remainingSlots('photo', 10)).toBe(0);
    expect(checkAdd('photo', 1, 10)).toEqual({ accepted: 0, problem: 'photoLimit' });
  });
  it('counts queued items and caps a multi-pick', () => {
    expect(remainingSlots('photo', 6, 2)).toBe(2);
    expect(checkAdd('photo', 5, 6, 2)).toEqual({ accepted: 2, problem: 'photoLimit' });
    expect(checkAdd('photo', 2, 6, 2)).toEqual({ accepted: 2, problem: null });
    expect(checkAdd('video', 1, 2)).toEqual({ accepted: 0, problem: 'videoLimit' });
    expect(remainingSlots('video', 1)).toBe(1);
  });
});

describe('checks', () => {
  it('refuses a 61 s video, allows 60.5 s and unknown', () => {
    expect(videoDurationProblem(61_000)).toBe('videoTooLong');
    expect(videoDurationProblem(60_500)).toBeNull();
    expect(videoDurationProblem(null)).toBeNull();
  });
  it('sizes per role', () => {
    expect(sizeProblem('full', 4_194_305)).toBe('tooLarge');
    expect(sizeProblem('full', 900_000)).toBeNull();
    expect(sizeProblem('thumb', 1_048_577)).toBe('tooLarge');
    expect(sizeProblem('video', 52_428_800)).toBeNull();
  });
  it('resize targets keep the long edge', () => {
    expect(resizeAction(4000, 3000, 1600)).toEqual({ width: 1600 });
    expect(resizeAction(3000, 4000, 1600)).toEqual({ height: 1600 });
    expect(resizeAction(1200, 800, 1600)).toBeNull();
    expect(resizeAction(0, 0, 480)).toEqual({ width: 480 });
  });
  it('content types', () => {
    expect(contentTypeFor('full', 'file:///a.png')).toBe('image/jpeg');
    expect(contentTypeFor('video', 'file:///a.MOV')).toBe('video/quicktime');
    expect(contentTypeFor('video', 'file:///a.mp4')).toBe('video/mp4');
  });
  it('every problem has an en key', () => {
    for (const key of Object.values(MEDIA_PROBLEM_KEYS)) expect(i18n.exists(key), key).toBe(true);
  });
});
