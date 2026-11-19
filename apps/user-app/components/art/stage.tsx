import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import Svg from 'react-native-svg';

/**
 * The layered drawing used by the onboarding art (mockup notes, "Building it in the app"): every moving part is its
 * own full-size `Svg` on the same view box, inside an `Animated.View` that the UI thread transforms. Only transforms
 * and opacity animate, so nothing re-renders while a drawing loops.
 *
 * Coordinates given to `Layer` (`origin`) and to the `vb()` helper are in view-box units; the stage converts them to
 * points.
 */

interface StageInfo {
  /** Points per view-box unit. */
  k: number;
  vbW: number;
  vbH: number;
}

const StageContext = createContext<StageInfo>({ k: 1, vbW: 100, vbH: 100 });

/** Points per view-box unit, for animated styles: `translateX: dx * k`. */
export function useStage(): StageInfo {
  return useContext(StageContext);
}

interface ArtStageProps {
  /** View box width and height. */
  vb: readonly [number, number];
  /** Drawn width in points; the height follows the view box. */
  width: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A decorative drawing: hidden from screen readers, never touchable. */
export function ArtStage({ vb, width, children, style }: ArtStageProps) {
  const info = useMemo(() => ({ k: width / vb[0], vbW: vb[0], vbH: vb[1] }), [width, vb]);
  const s = useMemo(() => StyleSheet.create({
    stage: { width, height: (width * vb[1]) / vb[0], alignSelf: 'center' },
  }), [width, vb]);
  return (
    <StageContext.Provider value={info}>
      <View
        style={[s.stage, style]}
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </View>
    </StageContext.Provider>
  );
}

interface LayerProps {
  /** Animated transform / opacity for this part. */
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** The pivot for rotate and scale, in view-box units (default: the view box's centre). */
  origin?: readonly [number, number];
  children: React.ReactNode;
}

/** One moving part: a full-size `Svg` on the stage's view box. Without a `style` it is a still layer. */
export function Layer({ style, origin, children }: LayerProps) {
  const { k, vbW, vbH } = useStage();
  const base = useMemo<ViewStyle>(() => ({
    ...StyleSheet.absoluteFillObject,
    transformOrigin: origin ? [origin[0] * k, origin[1] * k, 0] : undefined,
  }), [origin, k]);
  const svg = (
    <Svg width="100%" height="100%" viewBox={`0 0 ${vbW} ${vbH}`} style={{ overflow: 'visible' }}>
      {children}
    </Svg>
  );
  if (!style) return <View style={base}>{svg}</View>;
  return <Animated.View style={[base, style]}>{svg}</Animated.View>;
}
