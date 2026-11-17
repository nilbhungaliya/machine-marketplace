const MONEY_RE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const INT4_MAX = 2_147_483_647;

/** Exact rupee string → paise, no floating point. "149.5" → 14950. */
export function moneyStringToPaise(value: string): number {
  const m = MONEY_RE.exec(String(value));
  if (!m) throw new Error(`not a rupee amount: "${value}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Guards a paise value before it is written to an integer column. */
export function assertInt4Paise(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > INT4_MAX) {
    throw new Error(`paise out of range: ${paise}`);
  }
  return paise;
}
