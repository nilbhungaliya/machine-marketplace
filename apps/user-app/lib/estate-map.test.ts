import { describe, expect, it } from 'vitest';
import { PINGS, bearing, estateLabel, pingPercent, pingTracks } from './estate-map';
import { track } from './motion-track';

describe('bearing', () => {
  it('reads clockwise from straight up', () => {
    expect(bearing(128, 14)).toBeCloseTo(0);
    expect(bearing(228, 124)).toBeCloseTo(90);
    expect(bearing(128, 200)).toBeCloseTo(180);
    expect(bearing(28, 124)).toBeCloseTo(270);
  });
});

describe('pingPercent', () => {
  it('matches the mockup script for its seven pings', () => {
    // 46 + 24 × angle / 360, as the mockup's inline script computes it.
    const expected = PINGS.map(([x, y]) => {
      let a = (Math.atan2(x - 128, -(y - 124)) * 180) / Math.PI;
      if (a < 0) a += 360;
      return 46 + (24 * a) / 360;
    });
    expect(PINGS.map(([x, y]) => pingPercent(x, y))).toEqual(expected);
  });

  it('stays inside the sweep (46–70 %)', () => {
    for (const [x, y] of PINGS) {
      expect(pingPercent(x, y)).toBeGreaterThanOrEqual(46);
      expect(pingPercent(x, y)).toBeLessThan(70);
    }
  });
});

describe('pingTracks', () => {
  it('is dark before the sweep reaches it, lit after, gone at the end', () => {
    const [x, y] = PINGS[1];
    const p = pingPercent(x, y);
    const { opacity, scale } = pingTracks(x, y);
    expect(track(p - 0.5, opacity)).toBe(0);
    expect(track(p + 0.8, opacity)).toBe(1);
    expect(track(p + 0.8, scale)).toBeCloseTo(1.35);
    expect(track(80, opacity)).toBe(1);
    expect(track(80, scale)).toBe(1);
    expect(track(97, opacity)).toBe(0);
  });
});

describe('estateLabel', () => {
  it('joins the area and pincode', () => {
    expect(estateLabel('Aji GIDC', '360003')).toBe('AJI GIDC · 360003');
  });
  it('uses whichever is set, or none', () => {
    expect(estateLabel(null, '360003')).toBe('360003');
    expect(estateLabel('  Aji  GIDC ', '')).toBe('AJI GIDC');
    expect(estateLabel('', null)).toBeNull();
    expect(estateLabel(undefined, '  ')).toBeNull();
  });
});
