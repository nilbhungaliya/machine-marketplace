import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useType } from '@/hooks/use-type';
import { EASE, easeOut, track, type Frame } from '@/lib/motion-track';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

/**
 * 01 Welcome's L | R match token (mockup `.w-tokrow`): the left half is held (solid violet L), the right half is
 * wanted (the dashed R). A scan light passes over the dashed R, the solid R slides in along its rail and snaps (a ring
 * flashes), and "Right side" appears with a green dot. Same halves as `SideToken` at `xl`. Runs on the hub's clock
 * (`HUB_LOOP_MS`); at the rest frame the R is in place and found. Decorative: hidden from screen readers.
 */

/** `SideToken` xl. */
const BOX = 40;
const LETTER = 17;
const GAP = 2;
/** The mockup's R travels 70 px for a 36 px half: scaled to this half. */
const R_TRAVEL = (70 * BOX) / 36;

// Keyframes (mockup wScan, wR, wSnap, wFound).
const SCAN_X: readonly Frame[] = [[0, -1], [44, -1], [55, 1], [100, 1]];
const SCAN_O: readonly Frame[] = [[0, 0], [44, 0], [45, 1], [55, 1], [56, 0], [100, 0]];
const R_X: readonly Frame[] = [[0, 1], [56, 1], [64, 0], [88, 0], [94, 1], [100, 1]];
const R_O: readonly Frame[] = [[0, 0], [56, 0], [58, 1], [64, 1], [88, 1], [94, 0], [100, 0]];
const SNAP_O: readonly Frame[] = [[0, 0], [63.5, 0], [64.5, 0.8], [72, 0], [100, 0]];
const SNAP_S: readonly Frame[] = [[0, 0.92], [63.5, 0.92], [64.5, 0.96], [72, 1.18], [100, 1.18]];
const FOUND_O: readonly Frame[] = [[0, 0], [65, 0], [69, 1], [88, 1], [93, 0], [100, 0]];
const FOUND_X: readonly Frame[] = [[0, -8], [65, -8], [69, 0], [100, 0]];

interface MatchTokenProps {
  /** The hub's loop clock. */
  clock: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}

export default function MatchToken({ clock, style }: MatchTokenProps) {
  const { t } = useTranslation();
  const { colors, shadows } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, minHeight: BOX + 12 },
    tok: { flexDirection: 'row', gap: GAP },
    half: { width: BOX, height: BOX, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    left: {
      borderTopLeftRadius: radius.full, borderBottomLeftRadius: radius.full, borderTopRightRadius: 4, borderBottomRightRadius: 4,
      backgroundColor: colors.primary,
    },
    right: { borderTopRightRadius: radius.full, borderBottomRightRadius: radius.full, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
    need: { backgroundColor: colors.primaryWash, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary },
    solid: { position: 'absolute', left: BOX + GAP, top: 0, backgroundColor: colors.primary, overflow: 'visible', ...shadows.raised },
    scan: { ...StyleSheet.absoluteFillObject },
    ring: {
      position: 'absolute', top: -6, bottom: -6, left: -6, right: -6,
      borderRadius: radius.full, borderWidth: 2, borderColor: colors.primary,
    },
    letter: { ...type('badge'), fontSize: LETTER, lineHeight: Math.round(LETTER * 1.2), letterSpacing: 0 },
    onPrimary: { color: colors.onPrimary },
    ink: { color: colors.primaryInk },
    found: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.ok },
    foundText: { ...type('caption'), fontFamily: fonts.semiBold, color: colors.ok },
  }), [colors, shadows, type]);

  const scan = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, SCAN_O, EASE.rail), transform: [{ translateX: track(pct, SCAN_X, EASE.rail) * BOX }] };
  });
  const solidR = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, R_O, EASE.glide), transform: [{ translateX: track(pct, R_X, EASE.glide) * R_TRAVEL }] };
  });
  const snap = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, SNAP_O, easeOut), transform: [{ scale: track(pct, SNAP_S, easeOut) }] };
  });
  const found = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, FOUND_O, EASE.glide), transform: [{ translateX: track(pct, FOUND_X, EASE.glide) }] };
  });

  return (
    <View
      style={[s.row, style]}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={s.tok}>
        <Animated.View style={[s.ring, snap]} />
        <View style={[s.half, s.left]}>
          <Text style={[s.letter, s.onPrimary]}>L</Text>
        </View>
        <View style={[s.half, s.right, s.need]}>
          <Text style={[s.letter, s.ink]}>R</Text>
          <Animated.View style={[s.scan, scan]}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="w-scan" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={colors.primary} stopOpacity={0} />
                  <Stop offset="0.5" stopColor={colors.primary} stopOpacity={0.45} />
                  <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#w-scan)" />
            </Svg>
          </Animated.View>
        </View>
        <Animated.View style={[s.half, s.right, s.solid, solidR]}>
          <Text style={[s.letter, s.onPrimary]}>R</Text>
        </Animated.View>
      </View>
      <Animated.View style={[s.found, found]}>
        <View style={s.dot} />
        <Text style={s.foundText}>{t('listing.side.right')}</Text>
      </Animated.View>
    </View>
  );
}
