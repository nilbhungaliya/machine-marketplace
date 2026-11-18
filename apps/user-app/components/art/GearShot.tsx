import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

// The welcome screen's product shot (spec §7.4, Ruling R8): the mockup's `PARTS.gear` with its `g-steel`, `g-black`
// and `g-sh` gradients, ported to react-native-svg. The metal colours are illustration materials, not theme colours,
// which is why `components/art/` is on the style audit's allowlist. The sweep behind it and the holes use the theme.

/** The mockup's `gearPath`: 22 teeth, outer radius 39.5, root radius 33, centred on 50, 50. */
const GEAR_PATH = (() => {
  let d = '';
  const n = 22;
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? 33 : 39.5;
    const a = (i * Math.PI) / n;
    d += (i ? 'L' : 'M') + (50 + r * Math.cos(a)).toFixed(1) + ' ' + (50 + r * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
})();

/** The mockup's `ring(4, 14.5, 50, 50)`: four bolt holes, the first at the top. */
const HOLES = Array.from({ length: 4 }, (_, k) => {
  const a = (k * 2 * Math.PI) / 4 - Math.PI / 2;
  return { cx: (50 + 14.5 * Math.cos(a)).toFixed(1), cy: (50 + 14.5 * Math.sin(a)).toFixed(1) };
});

interface GearShotProps {
  /** The square's side; 172 by default. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** A steel gear on a white-to-photo sweep with a floating shadow (the mockup's `.thumb.big`). Decorative. */
export default function GearShot({ size = 172, style }: GearShotProps) {
  const { colors, shadows } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    // The shadow on the outer view, the clipping on the inner one, so the rounded corners never clip the shadow.
    shell: { width: size, height: size, borderRadius: 30, ...shadows.float },
    clip: { flex: 1, borderRadius: 30, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  }), [size, shadows]);
  const art = Math.round(size * 0.74);

  return (
    <View style={[s.shell, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={s.clip}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="gear-sweep" cx="50%" cy="15%" fx="50%" fy="15%" rx="130%" ry="100%">
              <Stop offset="0" stopColor={colors.surface} />
              <Stop offset="0.75" stopColor={colors.photo} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gear-sweep)" />
        </Svg>
        <Svg width={art} height={art} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="g-steel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F7F8FA" />
              <Stop offset="0.45" stopColor="#C7CAD2" />
              <Stop offset="1" stopColor="#7F838E" />
            </LinearGradient>
            <LinearGradient id="g-black" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#555761" />
              <Stop offset="0.4" stopColor="#2C2D33" />
              <Stop offset="1" stopColor="#17181C" />
            </LinearGradient>
            <RadialGradient id="g-sh">
              <Stop offset="0" stopColor="#1C1640" stopOpacity="0.28" />
              <Stop offset="1" stopColor="#1C1640" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50" cy="93" rx="33" ry="4" fill="url(#g-sh)" />
          <Path d={GEAR_PATH} fill="url(#g-steel)" stroke="#80848F" strokeWidth="0.6" />
          <Circle cx="50" cy="50" r="26" fill="#9DA1AB" />
          <Circle cx="50" cy="50" r="24" fill="url(#g-steel)" />
          {HOLES.map((h) => <Circle key={`${h.cx}-${h.cy}`} cx={h.cx} cy={h.cy} r="4.6" fill={colors.photo} />)}
          <Circle cx="50" cy="50" r="9" fill="url(#g-black)" />
          <Circle cx="50" cy="50" r="5.6" fill={colors.photo} />
          <Rect x="48" y="42.5" width="4" height="4" fill={colors.photo} />
        </Svg>
      </View>
    </View>
  );
}
