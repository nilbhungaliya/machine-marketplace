// Keyframe tracks for the onboarding drawings ("workshop precision", docs/mockups/onboarding-motion.html).
// The mockup's CSS keyframes become tracks here: a loop value t (0–1) is read as a percentage and interpolated between
// frames. Pure and worklet-safe (every function carries the 'worklet' directive), so the same code runs in tests and
// on the UI thread.

export type EaseFn = (x: number) => number;

/** A frame: [percent 0–100, value] or [percent, value, easing of the segment that starts here]. */
export type Frame = readonly [number, number] | readonly [number, number, EaseFn];

/** CSS `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  'worklet';
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x: number) => {
    'worklet';
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Solve x(s) = x for s: Newton first, bisection if it stalls.
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = ((ax * s + bx) * s + cx) * s - x;
      if (Math.abs(err) < 1e-6) return ((ay * s + by) * s + cy) * s;
      const d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 30; i++) {
      const v = ((ax * s + bx) * s + cx) * s;
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

/** CSS `steps(n, end)`: clicks, not a slide. */
export function steps(n: number): EaseFn {
  'worklet';
  return (x: number) => {
    'worklet';
    if (x >= 1) return 1;
    return Math.floor(x * n) / n;
  };
}

export const linear: EaseFn = (x: number) => {
  'worklet';
  return x;
};

/** CSS `ease-out`. */
export const easeOut = cubicBezier(0, 0, 0.58, 1);

/**
 * The four easings of the motion language (mockup `:root` and its "Motion language" row):
 * glide — fast travel, exact landing (parts, fields, the footer);
 * seat — one small settle when something lands (needles, rivets, typed digits);
 * rail — even start and stop (tool heads, lasers, calipers);
 * ratchet — clicks, not a slide (bolts, gear teeth, progress bars).
 */
export const EASE = {
  glide: cubicBezier(0.16, 0.84, 0.24, 1),
  seat: cubicBezier(0.34, 1.32, 0.6, 1),
  rail: cubicBezier(0.65, 0, 0.35, 1),
  ratchet: steps(6),
} as const;

/**
 * The value of a keyframe track at `pct` (0–100). Before the first frame it holds the first value, after the last
 * the last. Each segment uses the easing given on its starting frame, else `ease` (as a CSS animation's
 * timing function applies to every segment).
 */
export function track(pct: number, frames: readonly Frame[], ease: EaseFn = linear): number {
  'worklet';
  const n = frames.length;
  if (n === 0) return 0;
  if (pct <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < n - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (pct < b[0]) {
      const span = b[0] - a[0];
      if (span <= 0) return b[1];
      const f = a.length === 3 ? a[2] : ease;
      return a[1] + (b[1] - a[1]) * f((pct - a[0]) / span);
    }
  }
  return frames[n - 1][1];
}
