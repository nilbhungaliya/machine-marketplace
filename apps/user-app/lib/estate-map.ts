// The estate map's radar (onboarding "Where are you?", docs/mockups/onboarding-motion.html, screen 05): one sweep turns
// about the pin from 46 % to 70 % of the 12 s loop, and each business ping lights as the sweep's leading edge passes it.
// The mockup's script computes each ping's keyframes from its angle; this is that script, as tracks for `track()`.

import { easeOut, type Frame } from './motion-track';

/** The pin's point on the map (view box 0 0 264 180), the radar's centre. */
export const RADAR_CENTRE = [128, 124] as const;

/** The businesses around the pin, in view-box units. */
export const PINGS: readonly (readonly [number, number])[] = [
  [60, 26], [222, 30], [226, 72], [232, 128], [178, 160], [50, 160], [70, 128],
];

/** Where the sweep's leading edge starts (0° = straight up) and the loop percentages it turns over. */
const SWEEP_FROM = 46;
const SWEEP_SPAN = 24;

/** The angle of a point about the centre, clockwise from straight up, 0–360. */
export function bearing(x: number, y: number, [cx, cy]: readonly [number, number] = RADAR_CENTRE): number {
  let a = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  if (a < 0) a += 360;
  return a;
}

/** The loop percentage at which the sweep's leading edge reaches the point. */
export function pingPercent(x: number, y: number): number {
  return SWEEP_FROM + (SWEEP_SPAN * bearing(x, y)) / 360;
}

export interface PingTracks {
  opacity: readonly Frame[];
  scale: readonly Frame[];
}

/** A ping's keyframes (mockup `lp<i>`, ease-out): dark until the sweep reaches it, a pop, lit until the fade. */
export function pingTracks(x: number, y: number): PingTracks {
  const p = pingPercent(x, y);
  return {
    opacity: [[0, 0, easeOut], [p, 0, easeOut], [p + 0.8, 1, easeOut], [p + 3, 1, easeOut], [88, 1, easeOut], [94, 0, easeOut], [100, 0]],
    scale: [[0, 0.3, easeOut], [p, 0.3, easeOut], [p + 0.8, 1.35, easeOut], [p + 3, 1, easeOut], [100, 1]],
  };
}

/**
 * The plot label: the business's industrial area (upper-cased) and pincode, whichever are set, or null for no label.
 */
export function estateLabel(area: string | null | undefined, pincode: string | null | undefined): string | null {
  const parts = [area?.replace(/\s+/g, ' ').trim().toUpperCase(), pincode?.trim()].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : null;
}
