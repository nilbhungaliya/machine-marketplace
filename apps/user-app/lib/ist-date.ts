/** Minutes to add to UTC to reach the IST wall clock. India has no DST. */
export const IST_OFFSET_MIN = 5 * 60 + 30;

/**
 * Today's date in India, as `YYYY-MM-DD`, whatever timezone the device is set to.
 *
 * `new Date().toISOString().slice(0, 10)` is UTC and reads a day behind between
 * 00:00 and 05:29 IST; `getFullYear()/getMonth()/getDate()` reads the DEVICE's
 * calendar. Shifting by the offset and reading the UTC parts avoids both.
 *
 * @param nowMs current time in epoch ms (injected for testability)
 */
export function istDateKey(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10);
}
