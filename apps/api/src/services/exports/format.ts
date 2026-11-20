/**
 * CSV cell formats shared by the exports (admin close-out §10): times as IST `YYYY-MM-DD HH:mm`, money as rupees with
 * two decimals (the API keeps paise everywhere else).
 */

const IST_OFFSET_MS = 330 * 60_000;

/** An instant as IST `YYYY-MM-DD HH:mm` (India has no daylight saving, so a fixed +05:30); empty for an invalid date. */
export function istMinute(d: Date | string): string {
  const ms = (d instanceof Date ? d : new Date(d)).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** Paise as rupees with two decimals (`123450` → `'1234.50'`, `-5` → `'-0.05'`); empty for null. Exact for any bigint. */
export function rupees(paise: number | bigint | null): string {
  if (paise === null) return '';
  const p = typeof paise === 'bigint' ? paise : BigInt(Math.round(paise));
  const negative = p < 0n;
  const abs = negative ? -p : p;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
