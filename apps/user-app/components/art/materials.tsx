import React from 'react';
import { Defs, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * The parts' materials, copied from the onboarding motion mockup's shared `<defs>` (and the Periwinkle v2 mockup's
 * `g-steel` / `g-chrome` / `g-ball` / `g-black` / `g-brass`). Illustration colours, not theme colours: steel looks
 * like steel in both themes. Each `Svg` needs its own copy, so a layer renders `<Materials use={[…]} />` with the
 * ones it paints with, and refers to them as `url(#g-steel)` and so on.
 */

export type Material = 'steel' | 'chrome' | 'ball' | 'black' | 'brass' | 'brush' | 'shadow' | 'brushLines' | 'grid';

/** Ink drawn on steel parts (engraving, scale marks). */
export const STEEL_INK = '#3E414B';
export const STEEL_EDGE = '#7C808B';
export const STEEL_MID = '#9DA1AB';
export const STEEL_DARK = '#6B6F7A';
export const STEEL_SOFT = '#8E929C';
export const BORE = '#55575F';
/** Highlight on a steel edge. */
export const GLINT = '#FFFFFF';
/** The floor shadow's ink. */
export const SHADOW_INK = '#1C1A27';

interface MaterialsProps {
  use: readonly Material[];
  /** The blueprint grid's line colour (theme dependent), for `grid`. */
  gridColor?: string;
}

export default function Materials({ use, gridColor }: MaterialsProps) {
  const has = (m: Material) => use.includes(m);
  return (
    <Defs>
      {has('steel') ? (
        <LinearGradient id="g-steel" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F7F8FA" />
          <Stop offset="0.45" stopColor="#C7CAD2" />
          <Stop offset="1" stopColor="#7F838E" />
        </LinearGradient>
      ) : null}
      {has('chrome') ? (
        <LinearGradient id="g-chrome" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#8E929C" />
          <Stop offset="0.25" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#B4B8C1" />
          <Stop offset="1" stopColor="#6B6F7A" />
        </LinearGradient>
      ) : null}
      {has('ball') ? (
        <RadialGradient id="g-ball" cx="0.35" cy="0.3" r="0.75" fx="0.35" fy="0.3">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.5" stopColor="#B9BCC5" />
          <Stop offset="1" stopColor="#6F737E" />
        </RadialGradient>
      ) : null}
      {has('black') ? (
        <LinearGradient id="g-black" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#555761" />
          <Stop offset="0.4" stopColor="#2C2D33" />
          <Stop offset="1" stopColor="#17181C" />
        </LinearGradient>
      ) : null}
      {has('brass') ? (
        <LinearGradient id="g-brass" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#8E6618" />
          <Stop offset="0.45" stopColor="#F3D98A" />
          <Stop offset="1" stopColor="#9C7420" />
        </LinearGradient>
      ) : null}
      {has('brush') ? (
        <LinearGradient id="g-brush" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#C9CCD3" />
          <Stop offset="0.18" stopColor="#EEF0F3" />
          <Stop offset="0.42" stopColor="#D3D6DC" />
          <Stop offset="0.63" stopColor="#F4F5F7" />
          <Stop offset="0.85" stopColor="#CDD0D7" />
          <Stop offset="1" stopColor="#E4E6EA" />
        </LinearGradient>
      ) : null}
      {has('shadow') ? (
        <RadialGradient id="g-sh" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={SHADOW_INK} stopOpacity={0.28} />
          <Stop offset="1" stopColor={SHADOW_INK} stopOpacity={0} />
        </RadialGradient>
      ) : null}
      {has('brushLines') ? (
        <Pattern id="p-brush" width={6} height={2} patternUnits="userSpaceOnUse">
          <Rect width={6} height={0.5} fill={GLINT} opacity={0.35} />
        </Pattern>
      ) : null}
      {has('grid') && gridColor ? (
        <Pattern id="p-grid" width={12} height={12} patternUnits="userSpaceOnUse">
          <Path d="M12 0H0V12" fill="none" stroke={gridColor} strokeWidth={1} />
        </Pattern>
      ) : null}
    </Defs>
  );
}
