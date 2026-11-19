import AsyncStorage from '@react-native-async-storage/async-storage';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';

// Recent searches (F4 + F5 spec §8.4, R13): the last 10 queries the buyer submitted, newest first, on the phone only
// (never sent anywhere, never in analytics).

const KEY = 'search.recent.v1';

const tidy = (q: string): string => q.trim().replace(/\s+/g, ' ');

/** `q` at the top (a repeat moves up, case-insensitive, with the latest spelling); blanks ignored; at most 10. */
export function addRecent(list: readonly string[], q: string): string[] {
  const text = tidy(q);
  if (!text) return [...list];
  const lower = text.toLowerCase();
  return [text, ...list.filter((x) => x.toLowerCase() !== lower)].slice(0, DISCOVERY_LIMITS.recentSearches);
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, DISCOVERY_LIMITS.recentSearches)
      : [];
  } catch {
    return [];
  }
}

async function store(list: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // A convenience: losing it costs nothing.
  }
}

/** Adds a submitted query; resolves with the new list. */
export async function recordRecentSearch(q: string): Promise<string[]> {
  const next = addRecent(await loadRecentSearches(), q);
  await store(next);
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
