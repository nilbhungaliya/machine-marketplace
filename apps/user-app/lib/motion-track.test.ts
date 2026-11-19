import { describe, expect, it } from 'vitest';
import { EASE, cubicBezier, linear, steps, track } from './motion-track';

describe('cubicBezier', () => {
  it('is pinned at both ends', () => {
    const f = cubicBezier(0.16, 0.84, 0.24, 1);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(-1)).toBe(0);
    expect(f(2)).toBe(1);
  });

  it('matches a straight line for the linear curve', () => {
    const f = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.25, 0.5, 0.8]) expect(f(x)).toBeCloseTo(x, 4);
  });

  it('glide travels fast and lands exactly', () => {
    expect(EASE.glide(0.2)).toBeGreaterThan(0.5);
    expect(EASE.glide(0.9)).toBeLessThanOrEqual(1);
    expect(EASE.glide(0.9)).toBeGreaterThan(0.98);
  });

  it('seat overshoots once, a little', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => EASE.seat((i + 1) / 100)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.1);
  });

  it('rail is symmetric', () => {
    expect(EASE.rail(0.5)).toBeCloseTo(0.5, 4);
    expect(EASE.rail(0.2) + EASE.rail(0.8)).toBeCloseTo(1, 4);
  });
});

describe('steps', () => {
  it('clicks in n equal steps and ends at 1', () => {
    const f = steps(4);
    expect(f(0)).toBe(0);
    expect(f(0.24)).toBe(0);
    expect(f(0.25)).toBe(0.25);
    expect(f(0.99)).toBe(0.75);
    expect(f(1)).toBe(1);
  });
});

describe('track', () => {
  const frames = [[0, 10], [4, 10], [16, 0], [84, 0], [94, 10], [100, 10]] as const;

  it('holds the first and last values outside the frames', () => {
    expect(track(-5, frames)).toBe(10);
    expect(track(0, frames)).toBe(10);
    expect(track(100, frames)).toBe(10);
    expect(track(120, frames)).toBe(10);
  });

  it('holds between equal frames and interpolates between different ones', () => {
    expect(track(2, frames)).toBe(10);
    expect(track(10, frames, linear)).toBeCloseTo(5, 6);
    expect(track(50, frames)).toBe(0);
  });

  it('uses the easing given on a frame for its segment', () => {
    const half = (x: number) => (x < 0.5 ? 0 : 1);
    const f = [[0, 0, half], [10, 100], [20, 0]] as const;
    expect(track(4, f)).toBe(0);
    expect(track(6, f)).toBe(100);
    expect(track(15, f, linear)).toBeCloseTo(50, 6);
  });

  it('jumps on a zero-length segment', () => {
    expect(track(95.05, [[0, 49], [95, 49], [95, 0], [100, 0]])).toBe(0);
  });

  it('returns 0 for an empty track', () => {
    expect(track(50, [])).toBe(0);
  });
});
