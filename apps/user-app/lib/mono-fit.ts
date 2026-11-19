// Fitting a line of JetBrains Mono into a fixed width on an onboarding drawing (the nameplate's engraving, the estate
// map's plot label). SVG `textLength` / `lengthAdjust` isn't reliable on Android, so the size is computed here instead:
// JetBrains Mono advances every Latin glyph by exactly 0.6 em, which makes the width of a Latin line exact. Glyphs the
// font lacks (Devanagari, Gujarati) come from the OS fallback, so their width is an estimate.

/** JetBrains Mono's advance width, in em. */
export const MONO_ADVANCE = 0.6;
/** Estimated advance of a fallback-font glyph (Indic letters), in em. */
const FALLBACK_ADVANCE = 0.8;
export const ELLIPSIS = '…';

// Zero-width code points: combining diacritics, Devanagari / Gujarati vowel signs and viramas, ZWJ / ZWNJ.
const ZERO_WIDTH: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x0900, 0x0903], [0x093a, 0x093c], [0x093e, 0x094f], [0x0951, 0x0957], [0x0962, 0x0963],
  [0x0a81, 0x0a83], [0x0abc, 0x0abc], [0x0abe, 0x0acd], [0x0ae2, 0x0ae3],
  [0x200b, 0x200d],
];

/** The advance of one code point, in em. */
export function monoAdvance(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (ZERO_WIDTH.some(([a, b]) => cp >= a && cp <= b)) return 0;
  // Basic Latin, Latin-1, Latin Extended, general punctuation (·, …) and the rupee sign are in the font.
  if (cp < 0x0250 || (cp >= 0x2000 && cp <= 0x20cf)) return MONO_ADVANCE;
  return FALLBACK_ADVANCE;
}

/** The width of `text` in em. */
export function monoEms(text: string): number {
  let w = 0;
  for (const ch of Array.from(text)) w += monoAdvance(ch);
  return w;
}

export interface MonoFit {
  /** The text to draw: trimmed, single-spaced, ellipsised if it had to be cut. */
  text: string;
  fontSize: number;
  /** Its drawn width, in the same units as `maxWidth`. */
  width: number;
}

interface FitOptions {
  maxWidth: number;
  /** The size used when the text fits. */
  size: number;
  /** The smallest size it shrinks to before it is cut. */
  minSize: number;
}

/**
 * Fits `raw` into `maxWidth`: drawn at `size` when it fits, shrunk down to `minSize` when it doesn't, and cut with an
 * ellipsis when even `minSize` is too wide. An empty or blank string gives an empty line of width 0.
 */
export function fitMonoText(raw: string, { maxWidth, size, minSize }: FitOptions): MonoFit {
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (!clean) return { text: '', fontSize: size, width: 0 };
  const ems = monoEms(clean);
  if (ems * size <= maxWidth) return { text: clean, fontSize: size, width: ems * size };
  if (ems * minSize <= maxWidth) return { text: clean, fontSize: maxWidth / ems, width: maxWidth };

  const budget = maxWidth / minSize - MONO_ADVANCE; // room left for the text once the ellipsis is in
  let used = 0;
  let cut = '';
  for (const ch of Array.from(clean)) {
    const a = monoAdvance(ch);
    if (used + a > budget) break;
    used += a;
    cut += ch;
  }
  const text = cut.trimEnd() + ELLIPSIS;
  return { text, fontSize: minSize, width: monoEms(text) * minSize };
}
