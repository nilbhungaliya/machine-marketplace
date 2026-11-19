import AsyncStorage from '@react-native-async-storage/async-storage';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';

// Recently viewed (F4 + F5 spec §8.5, R13): the last 20 listing ids the buyer opened, newest first, on the phone only;
// the viewer's own listings are skipped. Home turns them into cards with `POST /discover/cards`, which drops the ones
// no longer public.

const KEY = 'discover.recent.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ViewedListing {
  listingId: string;
  businessId: string;
}

/** `entry` at the top (a repeat moves up), at most 20; unchanged when it's the viewer's own listing. */
export function addViewed(list: readonly string[], entry: ViewedListing, viewerBusinessId: string | null): string[] {
  if (viewerBusinessId && entry.businessId === viewerBusinessId) return [...list];
  return [entry.listingId, ...list.filter((id) => id !== entry.listingId)].slice(0, DISCOVERY_LIMITS.recentlyViewed);
}

export async function loadRecentlyViewed(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, DISCOVERY_LIMITS.recentlyViewed)
      : [];
  } catch {
    return [];
  }
}

/** Records an opened listing; resolves with the new list. */
export async function recordViewed(entry: ViewedListing, viewerBusinessId: string | null): Promise<string[]> {
  const before = await loadRecentlyViewed();
  const next = addViewed(before, entry, viewerBusinessId);
  if (next.length === before.length && next.every((id, i) => id === before[i])) return next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A convenience: losing it costs nothing.
  }
  return next;
}

export async function clearRecentlyViewed(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
