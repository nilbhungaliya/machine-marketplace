import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_RADIUS_KM,
  DISCOVERY_LIMITS,
  DISCOVERY_RADII_KM,
  type DiscoveryOrigin,
  type DiscoveryRadiusKm,
  type OriginEcho,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';
import { PINCODE_REGEX } from './onboarding-step';

// Where discovery measures distance from (F4 + F5 spec §6.3, §8.2, R2–R4, R18). Pure apart from AsyncStorage; the
// React side (permission prompt, GPS read, the sheet's actions) is hooks/use-discovery-origin.ts.
//
// - GPS first: granted → the phone's position, rounded to 3 decimals (the server snaps to 0.01°), cached 10 minutes,
//   sent with a fallback (the business when signed in, else the saved pincode).
// - Refused, unavailable, or the server answered `out_of_range` → the business (signed in), else the saved pincode,
//   else no origin (All India).
// - The location sheet can pin the choice to the business or to a typed pincode (`mode`).
// - Radius, pincode and the chosen source are stored on the phone; coordinates never are.

/** `auto` = GPS with the fallback; `business` / `pincode` = chosen in the location sheet. */
export type OriginMode = 'auto' | 'business' | 'pincode';
const MODES: readonly OriginMode[] = ['auto', 'business', 'pincode'];

/** Foreground location permission; `blocked` = refused and the system won't ask again (only Settings can change it). */
export type LocationPermission = 'undetermined' | 'granted' | 'denied' | 'blocked';

/** A GPS fix: rounded coordinates and when it was taken (ms). Memory only. */
export interface GpsFix {
  lat: number;
  lng: number;
  at: number;
}

export interface OriginInput {
  mode: OriginMode;
  signedIn: boolean;
  permission: LocationPermission;
  fix: GpsFix | null;
  /** The server said the last point was outside India (`origin.source: 'out_of_range'`). */
  outOfRange: boolean;
  pincode: string | null;
}

const FACTOR = 10 ** DISCOVERY_LIMITS.gpsDecimals;

/** Rounds a coordinate to 3 decimals (about 110 m) before it leaves the phone. */
export function roundCoord(n: number): number {
  return Math.round(n * FACTOR) / FACTOR;
}

export function isFixFresh(fix: GpsFix | null | undefined, now: number): boolean {
  return !!fix && now - fix.at < DISCOVERY_LIMITS.gpsCacheMs;
}

/** expo-location's answer as one of four states. */
export function permissionFrom(p: { status: string; canAskAgain?: boolean }): LocationPermission {
  if (p.status === 'granted') return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain === false ? 'blocked' : 'denied';
}

/** Home's first focus asks only while the permission was never answered, once per run; never after a refusal. */
export function shouldAskOnFocus(permission: LocationPermission, askedThisRun: boolean): boolean {
  return permission === 'undetermined' && !askedThisRun;
}

/** A typed pincode (Hindi and Gujarati digits accepted) as 6 ASCII digits, or null when it isn't one. */
export function normalisePincode(raw: string): string | null {
  const text = toAsciiDigits(raw).trim();
  return PINCODE_REGEX.test(text) ? text : null;
}

/** The fallback sent with a GPS point and used without one: the business when signed in, else the saved pincode. */
function fallbackOf(i: Pick<OriginInput, 'signedIn' | 'pincode'>): { business: true } | { pincode: string } | null {
  if (i.signedIn) return { business: true };
  if (i.pincode) return { pincode: i.pincode };
  return null;
}

/** The `DiscoveryOrigin` for a request (§6.3). */
export function buildOrigin(i: OriginInput): DiscoveryOrigin {
  if (i.mode === 'business' && i.signedIn) return { business: true };
  if (i.mode === 'pincode' && i.pincode) return { pincode: i.pincode };
  const fallback = fallbackOf(i);
  if (i.permission === 'granted' && i.fix && !i.outOfRange) {
    const point = { lat: i.fix.lat, lng: i.fix.lng };
    return fallback ? { point, fallback } : { point };
  }
  return fallback;
}

/** A deep, frozen copy: the origin a results list was opened with, sent with every later page and count (R18). */
export function freezeOrigin(origin: DiscoveryOrigin): DiscoveryOrigin {
  if (!origin) return null;
  const copy = JSON.parse(JSON.stringify(origin)) as Exclude<DiscoveryOrigin, null>;
  const deepFreeze = (o: object) => {
    for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    return Object.freeze(o);
  };
  return deepFreeze(copy) as DiscoveryOrigin;
}

// ─── Store (React-free; the hook subscribes with useSyncExternalStore) ───

export interface OriginState {
  mode: OriginMode;
  permission: LocationPermission;
  fix: GpsFix | null;
  outOfRange: boolean;
  pincode: string | null;
  /** `DiscoveryRadiusKm`, or null for All India. */
  radiusKm: DiscoveryRadiusKm | null;
  /** The last origin the server echoed (label for the location chip, never coordinates). */
  echo: OriginEcho | null;
  /** Stored preferences have been read. */
  hydrated: boolean;
}

export interface OriginStore {
  getSnapshot(): OriginState;
  subscribe(listener: () => void): () => void;
  hydrate(prefs: LocationPrefs): void;
  setPermission(permission: LocationPermission): void;
  /** A new GPS reading: rounded, timestamped now; clears an earlier `out_of_range`. */
  setFix(lat: number, lng: number): void;
  applyEcho(echo: OriginEcho): void;
  setMode(mode: OriginMode): void;
  setPincode(pincode: string | null): void;
  setRadius(radiusKm: DiscoveryRadiusKm | null): void;
  /**
   * Sign-out (DPDP, shared devices): forgets where this person looked from — mode back to `auto`, no pincode, no GPS
   * fix, no echo. The device's permission, the radius and `hydrated` stay.
   */
  reset(): void;
  /** True when GPS is granted and there is no fix younger than 10 minutes. */
  needsFix(): boolean;
  origin(signedIn: boolean): DiscoveryOrigin;
  /** `freezeOrigin(origin(signedIn))`. */
  freeze(signedIn: boolean): DiscoveryOrigin;
}

export function createOriginStore(): OriginStore {
  let state: OriginState = {
    mode: 'auto',
    permission: 'undetermined',
    fix: null,
    outOfRange: false,
    pincode: null,
    radiusKm: DEFAULT_RADIUS_KM,
    echo: null,
    hydrated: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<OriginState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  const originOf = (signedIn: boolean) => buildOrigin({ ...state, signedIn });

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: (prefs) => set({ ...prefs, hydrated: true }),
    setPermission: (permission) => set({ permission }),
    setFix: (lat, lng) => set({ fix: { lat: roundCoord(lat), lng: roundCoord(lng), at: Date.now() }, outOfRange: false }),
    applyEcho: (echo) => set({ echo, ...(echo.source === 'out_of_range' ? { outOfRange: true } : {}) }),
    setMode: (mode) => set({ mode }),
    setPincode: (pincode) => set({ pincode }),
    setRadius: (radiusKm) => set({ radiusKm }),
    reset: () => set({ mode: 'auto', pincode: null, fix: null, outOfRange: false, echo: null }),
    needsFix: () => state.permission === 'granted' && !isFixFresh(state.fix, Date.now()),
    origin: originOf,
    freeze: (signedIn) => freezeOrigin(originOf(signedIn)),
  };
}

// ─── Stored preferences (§8.2) ───

const RADIUS_KEY = 'discover.radius.v1';
const PINCODE_KEY = 'discover.pincode.v1';
const MODE_KEY = 'discover.mode.v1';
const ALL_INDIA = 'all';

export interface LocationPrefs {
  radiusKm: DiscoveryRadiusKm | null;
  pincode: string | null;
  mode: OriginMode;
}

function parseRadius(raw: string | null): DiscoveryRadiusKm | null {
  if (raw === ALL_INDIA) return null;
  const n = Number(raw);
  return (DISCOVERY_RADII_KM as readonly number[]).includes(n) ? (n as DiscoveryRadiusKm) : DEFAULT_RADIUS_KM;
}

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function write(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // A preference: the next cold start falls back to the default.
  }
}

export async function loadLocationPrefs(): Promise<LocationPrefs> {
  const [radius, pincode, mode] = await Promise.all([read(RADIUS_KEY), read(PINCODE_KEY), read(MODE_KEY)]);
  return {
    radiusKm: radius === null ? DEFAULT_RADIUS_KM : parseRadius(radius),
    pincode: pincode && PINCODE_REGEX.test(pincode) ? pincode : null,
    mode: MODES.includes(mode as OriginMode) ? (mode as OriginMode) : 'auto',
  };
}

export function saveRadius(radiusKm: DiscoveryRadiusKm | null): Promise<void> {
  return write(RADIUS_KEY, radiusKm === null ? ALL_INDIA : String(radiusKm));
}

export function savePincode(pincode: string | null): Promise<void> {
  return write(PINCODE_KEY, pincode);
}

export function saveMode(mode: OriginMode): Promise<void> {
  return write(MODE_KEY, mode);
}
