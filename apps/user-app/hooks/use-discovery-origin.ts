import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { useSelector } from 'react-redux';
import * as Location from 'expo-location';
import type { DiscoveryOrigin, DiscoveryRadiusKm, OriginEcho } from '@mpm/shared-types';
import { track } from '@/lib/analytics';
import { DISCOVERY_EVENTS } from '@/lib/analytics-events';
import {
  createOriginStore,
  loadLocationPrefs,
  permissionFrom,
  saveMode,
  savePincode,
  saveRadius,
  shouldAskOnFocus,
  type LocationPermission,
  type OriginMode,
} from '@/lib/discovery-origin';
import { clearRecentSearches } from '@/lib/recent-searches';
import { clearRecentlyViewed } from '@/lib/recently-viewed';
import type { RootState } from '@/store';

// The discovery origin on the phone (F4 + F5 spec §8.2, R2–R4, R18): one store for the whole app (Home, Search,
// results, the location sheet), hydrated once from AsyncStorage. Coordinates live only in memory. No analytics or log
// line ever carries a coordinate or a pincode: events send the source and the radius only (§11).

const store = createOriginStore();
/** The app's one origin store. Screens use `useDiscoveryOrigin`; exported for sign-out tests. */
export const originStore = store;
let hydrating: Promise<void> | null = null;
let askedThisRun = false;
let locating: Promise<void> | null = null;

function hydrate(): Promise<void> {
  if (!hydrating) hydrating = loadLocationPrefs().then((prefs) => store.hydrate(prefs));
  return hydrating;
}

/** Reads the GPS once (balanced accuracy); a failure (location services off, timeout) keeps the fallback. */
function locate(): Promise<void> {
  if (!locating) {
    locating = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((p) => store.setFix(p.coords.latitude, p.coords.longitude))
      .catch(() => undefined)
      .finally(() => {
        locating = null;
      });
  }
  return locating;
}

async function readPermission(): Promise<LocationPermission> {
  try {
    const permission = permissionFrom(await Location.getForegroundPermissionsAsync());
    store.setPermission(permission);
    return permission;
  } catch {
    return store.getSnapshot().permission;
  }
}

async function askPermission(): Promise<LocationPermission> {
  try {
    const permission = permissionFrom(await Location.requestForegroundPermissionsAsync());
    store.setPermission(permission);
    track(DISCOVERY_EVENTS.locationPermissionAnswered, { granted: permission === 'granted' });
    return permission;
  } catch {
    return store.getSnapshot().permission;
  }
}

/**
 * Sign-out: the in-memory origin forgets this person's pincode, chosen source, GPS fix and last echo, and Home may ask
 * for the permission again on the next run.
 */
export function resetDiscoveryOrigin(): void {
  store.reset();
  askedThisRun = false;
}

/**
 * Sign-out clears what this device remembers about the person's discovery (DPDP; shared devices): recently viewed,
 * recent searches, the stored pincode and source, and the in-memory origin. Storage failures never block sign-out.
 */
export async function clearDiscoveryOnDevice(): Promise<void> {
  resetDiscoveryOrigin();
  // Each of these swallows its own storage error.
  await Promise.all([clearRecentlyViewed(), clearRecentSearches(), savePincode(null), saveMode('auto')]);
}

export interface DiscoveryOriginApi {
  /** The origin for the next request (send it in POST bodies only). */
  origin: DiscoveryOrigin;
  radiusKm: DiscoveryRadiusKm | null;
  mode: OriginMode;
  pincode: string | null;
  permission: LocationPermission;
  /** The last origin the server echoed: the location chip's label and source. */
  echo: OriginEcho | null;
  /** Stored radius / pincode have been read (wait for it before the first request). */
  ready: boolean;
  signedIn: boolean;
  /**
   * Home's focus (§8.2): asks for the permission the first time it was never answered, then reads the GPS when the
   * cached fix is older than 10 minutes. Never asks again by itself after a refusal.
   */
  refreshOnFocus(): Promise<void>;
  /** The sheet's "Use my location": asks again, or opens the system settings when the permission is blocked. */
  chooseGps(): Promise<LocationPermission>;
  /** The sheet's "Use my business location" (signed in only). */
  chooseBusiness(): void;
  /** The sheet's pincode (already validated as 6 digits). */
  choosePincode(pincode: string): void;
  chooseRadius(radiusKm: DiscoveryRadiusKm | null): void;
  /** Hand every response's `origin` echo here: `out_of_range` switches to the fallback (§6.3). */
  reportEcho(echo: OriginEcho): void;
  /** The origin to send with every page and count of a list opened now (R18). */
  freeze(): DiscoveryOrigin;
}

export function useDiscoveryOrigin(): DiscoveryOriginApi {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const signedIn = useSelector((s: RootState) => s.auth.isAuthenticated);

  useEffect(() => {
    void hydrate();
  }, []);

  const changed = useCallback((source: OriginMode | 'radius') => {
    const radiusKm = store.getSnapshot().radiusKm;
    track(DISCOVERY_EVENTS.locationChanged, { source: source === 'auto' ? 'gps' : source, radiusKm });
  }, []);

  const refreshOnFocus = useCallback(async () => {
    await hydrate();
    let permission = await readPermission();
    if (shouldAskOnFocus(permission, askedThisRun)) {
      askedThisRun = true;
      permission = await askPermission();
    }
    if (permission === 'granted' && store.needsFix()) await locate();
  }, []);

  const chooseGps = useCallback(async () => {
    let permission = await readPermission();
    if (permission !== 'granted') {
      if (permission === 'blocked') {
        void Linking.openSettings();
        return permission;
      }
      askedThisRun = true;
      permission = await askPermission();
    }
    store.setMode('auto');
    void saveMode('auto');
    if (permission === 'granted') await locate();
    changed('auto');
    return permission;
  }, [changed]);

  const chooseBusiness = useCallback(() => {
    store.setMode('business');
    void saveMode('business');
    changed('business');
  }, [changed]);

  const choosePincode = useCallback((pincode: string) => {
    store.setPincode(pincode);
    store.setMode('pincode');
    void savePincode(pincode);
    void saveMode('pincode');
    changed('pincode');
  }, [changed]);

  const chooseRadius = useCallback((radiusKm: DiscoveryRadiusKm | null) => {
    store.setRadius(radiusKm);
    void saveRadius(radiusKm);
    changed('radius');
  }, [changed]);

  const reportEcho = useCallback((echo: OriginEcho) => {
    const { echo: prev, outOfRange } = store.getSnapshot();
    const same = prev?.label === echo.label && prev?.source === echo.source;
    // An unchanged echo is skipped (no re-render), unless it says out_of_range again after a new fix cleared the flag.
    if (same && (echo.source !== 'out_of_range' || outOfRange)) return;
    store.applyEcho(echo);
  }, []);

  const freeze = useCallback(() => store.freeze(signedIn), [signedIn]);

  // Recomputed only when the state or the session changes, so query keys built from it stay stable.
  const origin = useMemo(() => store.origin(signedIn), [state, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    origin,
    radiusKm: state.radiusKm,
    mode: state.mode,
    pincode: state.pincode,
    permission: state.permission,
    echo: state.echo,
    ready: state.hydrated,
    signedIn,
    refreshOnFocus,
    chooseGps,
    chooseBusiness,
    choosePincode,
    chooseRadius,
    reportEcho,
    freeze,
  };
}
