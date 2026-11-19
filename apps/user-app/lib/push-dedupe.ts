import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Foreground dedupe (F6 + F7 spec §11.5; ported from textile `lib/push-dedupe.ts`): push is at least once, so a retried
 * send can reach the phone twice. The app keeps the delivery keys (`<notificationId>:<version>`) of the last 100 pushes
 * it showed and skips one it has seen: a retry repeats its key and is dropped; a grouped chat row's update has a new
 * version and shows. Kept in AsyncStorage, so it holds across a kill and reopen.
 */
export const SHOWN_PUSH_KEYS = 'push.shown_delivery_keys';
export const SHOWN_PUSH_LIMIT = 100;

/** Pure: whether `key` was seen, and the list to keep (newest last, at most `limit`, the oldest dropped). */
export function rememberDeliveryKey(
  keys: readonly string[],
  key: string,
  limit: number = SHOWN_PUSH_LIMIT,
): { seen: boolean; keys: string[] } {
  if (keys.includes(key)) return { seen: true, keys: [...keys] };
  return { seen: false, keys: [...keys, key].slice(-limit) };
}

/** Reads the stored list; anything unreadable is an empty list. */
export function parseStoredKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Pushes arrive close together: one check at a time, so two copies landing at once can't both pass. */
let queue: Promise<unknown> = Promise.resolve();

/** True the first time a delivery key is seen, false after. A storage failure shows the push: a rare repeat beats a lost alert. */
export function shouldShowPush(deliveryKey: string): Promise<boolean> {
  const next = queue.then(() => check(deliveryKey));
  queue = next.catch(() => undefined);
  return next;
}

async function check(deliveryKey: string): Promise<boolean> {
  try {
    const { seen, keys } = rememberDeliveryKey(parseStoredKeys(await AsyncStorage.getItem(SHOWN_PUSH_KEYS)), deliveryKey);
    if (seen) return false;
    await AsyncStorage.setItem(SHOWN_PUSH_KEYS, JSON.stringify(keys));
    return true;
  } catch {
    return true;
  }
}
