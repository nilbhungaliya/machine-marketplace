import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useOnce } from '@/hooks/use-loop';
import { useReducedMotion } from '@/lib/motion';
import { EASE, track } from '@/lib/motion-track';
import { useTheme } from '@/lib/theme';

/**
 * The onboarding screens' shared entrances (mockup "shared entrances"), each played once when the screen mounts and
 * skipped under reduce motion:
 * - `WipeTitle`: a tool head (violet bar, yellow tip) runs along the heading and leaves the text behind it (rail);
 * - `SlideIn`: a block slides in from the left (glide), optionally along a guide rail drawn down its left edge;
 * - `FootIn`: the footer bar rises in from below;
 * - `ArtIn`: the drawing settles in (a 3 % scale and a fade).
 * Delays are in milliseconds, matching the mockup's `--d` / `--b` values.
 */

interface WipeTitleProps {
  children: string;
  textStyle: StyleProp<TextStyle>;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function WipeTitle({ children, textStyle, delay = 200, style, testID }: WipeTitleProps) {
  const reduced = useReducedMotion();
  const { colors } = useTheme();
  const p = useOnce(850, delay);
  // The text's own width (its widest line) and the box's width: the wipe runs over the text, not the whole box.
  const [textW, setTextW] = useState(0);
  const [boxW, setBoxW] = useState(0);

  const s = useMemo(() => StyleSheet.create({
    clip: { overflow: 'hidden' },
    tool: { position: 'absolute', top: -1, bottom: -1, left: 0, width: 2, borderRadius: 2, overflow: 'hidden' },
    tip: { height: 5, backgroundColor: colors.sun },
    bar: { flex: 1, backgroundColor: colors.primary },
  }), [colors]);

  const measured = textW > 0 && boxW > 0;
  const shift = useAnimatedStyle(() => {
    const e = EASE.rail(p.value);
    // The box slides left and the text right by the same amount, so the window reveals [0, e × textW].
    const d = p.value >= 1 || !measured ? 0 : (1 - e) * textW + (boxW - textW);
    return { transform: [{ translateX: -d }], opacity: measured || p.value >= 1 ? 1 : 0 };
  });
  const counter = useAnimatedStyle(() => {
    const e = EASE.rail(p.value);
    const d = p.value >= 1 || !measured ? 0 : (1 - e) * textW + (boxW - textW);
    return { transform: [{ translateX: d }] };
  });
  const tool = useAnimatedStyle(() => ({
    transform: [{ translateX: EASE.rail(p.value) * textW }],
    opacity: measured ? track(p.value * 100, [[0, 1], [88, 1], [100, 0]]) : 0,
  }));

  if (reduced) return <Animated.Text style={[textStyle, style as StyleProp<TextStyle>]} testID={testID}>{children}</Animated.Text>;

  return (
    <View style={style} onLayout={(e: LayoutChangeEvent) => setBoxW(e.nativeEvent.layout.width)}>
      <Animated.View style={[s.clip, shift]}>
        <Animated.Text
          style={[textStyle, counter]}
          testID={testID}
          onTextLayout={(e) => {
            const w = Math.ceil(Math.max(0, ...e.nativeEvent.lines.map((l) => l.x + l.width)));
            setTextW(w);
          }}
        >
          {children}
        </Animated.Text>
      </Animated.View>
      <Animated.View style={[s.tool, tool]}>
        <View style={s.tip} />
        <View style={s.bar} />
      </Animated.View>
    </View>
  );
}

interface SlideInProps {
  delay?: number;
  /** Draw the guide rail down the left edge first (fields). */
  rail?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SlideIn({ delay = 600, rail = false, children, style }: SlideInProps) {
  const { colors } = useTheme();
  const p = useOnce(700, delay);
  const q = useOnce(1000, Math.max(0, delay - 120));
  const s = useMemo(() => StyleSheet.create({
    rail: {
      position: 'absolute', left: -9, top: 2, bottom: 2, width: 2, borderRadius: 2, backgroundColor: colors.primary,
      transformOrigin: 'top',
    },
  }), [colors]);
  const slide = useAnimatedStyle(() => {
    const e = EASE.glide(p.value);
    return { opacity: e, transform: [{ translateX: -14 * (1 - e) }] };
  });
  const line = useAnimatedStyle(() => {
    const pct = q.value * 100;
    return {
      transform: [{ scaleY: track(pct, [[0, 0], [40, 1]], EASE.glide) }],
      opacity: q.value >= 1 ? 0 : track(pct, [[0, 1], [40, 1], [100, 0]], EASE.glide),
    };
  });
  return (
    <Animated.View style={[style, slide]}>
      {children}
      {rail ? <Animated.View style={[s.rail, line]} pointerEvents="none" /> : null}
    </Animated.View>
  );
}

export function FootIn({ children, delay = 1150 }: { children: React.ReactNode; delay?: number }) {
  const p = useOnce(800, delay);
  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: 120 * (1 - EASE.glide(p.value)) }] }));
  return <Animated.View style={rise}>{children}</Animated.View>;
}

export function ArtIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useOnce(1000, 50);
  const settle = useAnimatedStyle(() => {
    const e = EASE.glide(p.value);
    return { opacity: e, transform: [{ scale: 0.97 + 0.03 * e }] };
  });
  return <Animated.View style={[style, settle]}>{children}</Animated.View>;
}
