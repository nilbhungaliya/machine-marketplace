import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let asyncStore: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncStore[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete asyncStore[k];
    }),
  },
}));

import {
  buildOrigin,
  createOriginStore,
  freezeOrigin,
  isFixFresh,
  loadLocationPrefs,
  normalisePincode,
  permissionFrom,
  roundCoord,
  saveMode,
  savePincode,
  saveRadius,
  shouldAskOnFocus,
  type OriginInput,
} from './discovery-origin';

const fix = { lat: 22.304, lng: 70.802, at: 0 };
const base: OriginInput = { mode: 'auto', signedIn: false, permission: 'granted', fix, outOfRange: false, pincode: null };

beforeEach(() => {
  asyncStore = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('origin (spec §6.3, §8.2, R2)', () => {
  it('GPS granted: the point, with the fallback for out-of-range', () => {
    expect(buildOrigin(base)).toEqual({ point: { lat: 22.304, lng: 70.802 } });
    expect(buildOrigin({ ...base, pincode: '360003' })).toEqual({ point: { lat: 22.304, lng: 70.802 }, fallback: { pincode: '360003' } });
    expect(buildOrigin({ ...base, signedIn: true, pincode: '360003' })).toEqual({
      point: { lat: 22.304, lng: 70.802 },
      fallback: { business: true },
    });
  });

  it('refused: the business when signed in, else the saved pincode, else none (All India)', () => {
    expect(buildOrigin({ ...base, permission: 'denied', fix: null, signedIn: true })).toEqual({ business: true });
    expect(buildOrigin({ ...base, permission: 'blocked', fix: null, pincode: '395003' })).toEqual({ pincode: '395003' });
    expect(buildOrigin({ ...base, permission: 'denied', fix: null })).toBeNull();
  });

  it('a stale grant without a fix yet uses the fallback; a fix with a refusal is never sent', () => {
    expect(buildOrigin({ ...base, fix: null, signedIn: true })).toEqual({ business: true });
    expect(buildOrigin({ ...base, permission: 'denied' })).toBeNull();
    expect(buildOrigin({ ...base, permission: 'undetermined', fix: null })).toBeNull();
  });

  it('out_of_range: behaves as after a refusal', () => {
    expect(buildOrigin({ ...base, outOfRange: true, signedIn: true })).toEqual({ business: true });
    expect(buildOrigin({ ...base, outOfRange: true, pincode: '360003' })).toEqual({ pincode: '360003' });
    expect(buildOrigin({ ...base, outOfRange: true })).toBeNull();
  });

  it('the sheet choices: business (signed in only) and pincode', () => {
    expect(buildOrigin({ ...base, mode: 'business', signedIn: true })).toEqual({ business: true });
    // A guest can't use a business location: back to the automatic choice.
    expect(buildOrigin({ ...base, mode: 'business' })).toEqual({ point: { lat: 22.304, lng: 70.802 } });
    expect(buildOrigin({ ...base, mode: 'pincode', pincode: '360003', signedIn: true })).toEqual({ pincode: '360003' });
    expect(buildOrigin({ ...base, mode: 'pincode', pincode: null })).toEqual({ point: { lat: 22.304, lng: 70.802 } });
  });

  it('rounds coordinates to 3 decimals on the phone', () => {
    expect(roundCoord(22.3039876)).toBe(22.304);
    expect(roundCoord(70.80249)).toBe(70.802);
    expect(roundCoord(-0.0005)).toBe(-0);
    const store = createOriginStore();
    store.setPermission('granted');
    store.setFix(22.3039876, 70.8025123);
    expect(store.origin(false)).toEqual({ point: { lat: 22.304, lng: 70.803 } });
  });

  it('permission states and the first-focus ask', () => {
    expect(permissionFrom({ status: 'granted', canAskAgain: true })).toBe('granted');
    expect(permissionFrom({ status: 'undetermined', canAskAgain: true })).toBe('undetermined');
    expect(permissionFrom({ status: 'denied', canAskAgain: true })).toBe('denied');
    expect(permissionFrom({ status: 'denied', canAskAgain: false })).toBe('blocked');
    expect(shouldAskOnFocus('undetermined', false)).toBe(true);
    // Never asks again by itself: not after a refusal, not twice in one run.
    expect(shouldAskOnFocus('undetermined', true)).toBe(false);
    expect(shouldAskOnFocus('denied', false)).toBe(false);
    expect(shouldAskOnFocus('blocked', false)).toBe(false);
    expect(shouldAskOnFocus('granted', false)).toBe(false);
  });

  it('pincode entry accepts Hindi and Gujarati digits', () => {
    expect(normalisePincode(' 360003 ')).toBe('360003');
    expect(normalisePincode('३६०००३')).toBe('360003');
    expect(normalisePincode('૩૯૫૦૦૩')).toBe('395003');
    expect(normalisePincode('060003')).toBeNull();
    expect(normalisePincode('36000')).toBeNull();
    expect(normalisePincode('36a003')).toBeNull();
  });
});

describe('origin store', () => {
  it('an out_of_range echo switches to the fallback next time; a new fix tries GPS again', () => {
    const store = createOriginStore();
    store.setPermission('granted');
    store.setFix(51.5, -0.12);
    expect(store.origin(true)).toEqual({ point: { lat: 51.5, lng: -0.12 }, fallback: { business: true } });
    store.applyEcho({ label: null, source: 'out_of_range' });
    expect(store.origin(true)).toEqual({ business: true });
    expect(store.getSnapshot().echo).toEqual({ label: null, source: 'out_of_range' });
    store.setFix(22.3, 70.8);
    expect(store.origin(true)).toEqual({ point: { lat: 22.3, lng: 70.8 }, fallback: { business: true } });
  });

  it('the GPS fix is cached for 10 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    const store = createOriginStore();
    store.setPermission('granted');
    store.setFix(22.3, 70.8);
    expect(isFixFresh(store.getSnapshot().fix, Date.now())).toBe(true);
    expect(store.needsFix()).toBe(false);
    vi.advanceTimersByTime(9 * 60_000);
    expect(store.needsFix()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(store.needsFix()).toBe(true);
    expect(isFixFresh(null, Date.now())).toBe(false);
  });

  it('a frozen origin is unchanged after the cache refreshes (R18)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    const store = createOriginStore();
    store.setPermission('granted');
    store.setFix(22.3, 70.8);
    const frozen = store.freeze(false);
    vi.advanceTimersByTime(11 * 60_000);
    expect(store.needsFix()).toBe(true);
    store.setFix(22.5, 70.9);
    expect(store.origin(false)).toEqual({ point: { lat: 22.5, lng: 70.9 } });
    expect(frozen).toEqual({ point: { lat: 22.3, lng: 70.8 } });
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('freezeOrigin copies deeply', () => {
    const origin = { point: { lat: 1, lng: 2 }, fallback: { pincode: '360003' } };
    const frozen = freezeOrigin(origin);
    origin.point.lat = 9;
    expect(frozen).toEqual({ point: { lat: 1, lng: 2 }, fallback: { pincode: '360003' } });
    expect(freezeOrigin(null)).toBeNull();
  });

  it('notifies subscribers on every change', () => {
    const store = createOriginStore();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.setRadius(25);
    store.setMode('pincode');
    off();
    store.setRadius(10);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('origin store reset (sign-out)', () => {
  it('forgets mode, pincode, fix and echo; keeps the permission and the radius', () => {
    const store = createOriginStore();
    store.hydrate({ radiusKm: 25, pincode: '360003', mode: 'pincode' });
    store.setPermission('granted');
    store.setFix(22.3, 70.8);
    store.applyEcho({ source: 'out_of_range', label: 'Rajkot' } as never);
    store.reset();
    const s = store.getSnapshot();
    expect(s).toMatchObject({ mode: 'auto', pincode: null, fix: null, echo: null, outOfRange: false });
    expect(s).toMatchObject({ permission: 'granted', radiusKm: 25, hydrated: true });
  });
});

describe('radius and pincode storage (spec §8.2)', () => {
  it('round trips radius, pincode and the chosen source', async () => {
    expect(await loadLocationPrefs()).toEqual({ radiusKm: 50, pincode: null, mode: 'auto' });
    await saveRadius(25);
    await savePincode('360003');
    await saveMode('pincode');
    expect(await loadLocationPrefs()).toEqual({ radiusKm: 25, pincode: '360003', mode: 'pincode' });
    await saveRadius(null);
    await savePincode(null);
    expect(await loadLocationPrefs()).toEqual({ radiusKm: null, pincode: null, mode: 'pincode' });
  });

  it('ignores bad stored values', async () => {
    asyncStore['discover.radius.v1'] = '37';
    asyncStore['discover.pincode.v1'] = 'abc';
    asyncStore['discover.mode.v1'] = 'gps-everywhere';
    expect(await loadLocationPrefs()).toEqual({ radiusKm: 50, pincode: null, mode: 'auto' });
  });

  it('never stores coordinates', async () => {
    const store = createOriginStore();
    store.setFix(22.3039876, 70.8025123);
    await saveRadius(100);
    await savePincode('360003');
    await saveMode('auto');
    const stored = JSON.stringify(asyncStore);
    expect(stored).not.toMatch(/22\.30|70\.80/);
    expect(Object.keys(asyncStore).sort()).toEqual(['discover.mode.v1', 'discover.pincode.v1', 'discover.radius.v1']);
  });
});
