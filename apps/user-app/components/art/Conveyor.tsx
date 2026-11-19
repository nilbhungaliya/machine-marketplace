import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useOnce } from '@/hooks/use-loop';
import { EASE } from '@/lib/motion-track';
import { useTheme } from '@/lib/theme';

/**
 * The conveyor under the activity chips (onboarding "Your business", mockup screen 04 `bTiles` / `bBelt` / `bRoll`):
 * once, on mount, the chips ride in from the left over a belt whose dashes travel with them and whose rollers turn
 * (1.5 s glide after 0.45 s). Under reduce motion everything is in place from the start. The belt is decorative:
 * hidden from screen readers and never touchable; the chips stay fully interactive.
 */

const DURATION = 1500;
const DELAY = 450;
const ROLLERS = 7;
const ROLLER = 9;
/** The belt's dash pattern (8 on, 4 off) and how far it travels (mockup: 288 px, 24 dashes). */
const DASH = 12;
const BELT_TRAVEL = 288;

interface ConveyorProps {
  children: React.ReactNode;
  /** How far the belt reaches past the content on each side (the screen's side padding, to run edge to edge). */
  bleed?: number;
  style?: StyleProp<ViewStyle>;
}

export default function Conveyor({ children, bleed = 0, style }: ConveyorProps) {
  const { colors } = useTheme();
  const { width: screenW } = useWindowDimensions();
  const p = useOnce(DURATION, DELAY);

  const ride = useAnimatedStyle(() => ({ transform: [{ translateX: -screenW * (1 - EASE.glide(p.value)) }] }));
  const belt = useAnimatedStyle(() => ({ transform: [{ translateX: -BELT_TRAVEL * (1 - EASE.glide(p.value)) }] }));
  const roll = useAnimatedStyle(() => ({ transform: [{ rotate: `${-720 * (1 - EASE.glide(p.value))}deg` }] }));

  const s = useMemo(() => StyleSheet.create({
    belt: { height: 14, marginTop: 4, marginHorizontal: -bleed, overflow: 'hidden' },
    dashes: { position: 'absolute', left: 0, top: 0, height: 3, width: screenW + BELT_TRAVEL + DASH },
    rollers: { position: 'absolute', left: 10, right: 10, top: 4, flexDirection: 'row', justifyContent: 'space-between' },
    roller: { width: ROLLER, height: ROLLER },
  }), [bleed, screenW]);

  const c = ROLLER / 2;
  return (
    <View style={style}>
      <Animated.View style={ride}>{children}</Animated.View>
      <View style={s.belt} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Animated.View style={[s.dashes, belt]}>
          <Svg width="100%" height={3}>
            <Line
              x1={0} y1={1.5} x2={screenW + BELT_TRAVEL + DASH} y2={1.5}
              stroke={colors.textMuted} strokeWidth={3} strokeDasharray="8 4" opacity={0.55}
            />
          </Svg>
        </Animated.View>
        <View style={s.rollers}>
          {Array.from({ length: ROLLERS }, (_, i) => (
            <Animated.View key={i} style={[s.roller, roll]}>
              <Svg width={ROLLER} height={ROLLER}>
                <Circle cx={c} cy={c} r={c} fill={colors.border} />
                {/* Quarters 1 and 3 dark, as the mockup's conic gradient. */}
                <Path d={`M${c} ${c}L${c} 0A${c} ${c} 0 0 1 ${ROLLER} ${c}Z`} fill={colors.textMuted} />
                <Path d={`M${c} ${c}L${c} ${ROLLER}A${c} ${c} 0 0 1 0 ${c}Z`} fill={colors.textMuted} />
              </Svg>
            </Animated.View>
          ))}
        </View>
      </View>
    </View>
  );
}
