// Gujarati (૦–૯) and Devanagari/Hindi (०–९) keyboards type their own digits.
// Each block is ten consecutive code points starting at zero.
const DIGIT_ZEROS = [0x0ae6, 0x0966];

/** Maps Gujarati and Hindi digits to 0–9; every other character is left alone. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[૦-૯०-९]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9)!;
    return String(code - zero);
  });
}
