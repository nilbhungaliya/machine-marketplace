import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

/**
 * The welcome screen's glow (Periwinkle v2 `.welcome`, spec §7.4): a radial gradient from the top-left corner,
 * `heroGlow` fading into `background` by 70 %. Drawn absolutely behind the screen's content.
 */
export default function HeroGlow({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <Svg style={[StyleSheet.absoluteFill, style]} width="100%" height="100%" pointerEvents="none" accessible={false}>
      <Defs>
        <RadialGradient id="hero-glow" cx="0" cy="0" fx="0" fy="0" rx="120%" ry="70%">
          <Stop offset="0" stopColor={colors.heroGlow} />
          <Stop offset="0.7" stopColor={colors.background} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero-glow)" />
    </Svg>
  );
}
