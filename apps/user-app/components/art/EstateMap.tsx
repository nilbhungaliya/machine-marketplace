import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Circle, Ellipse, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useLoop } from '@/hooks/use-loop';
import { PINGS, RADAR_CENTRE, pingTracks } from '@/lib/estate-map';
import { fitMonoText } from '@/lib/mono-fit';
import { EASE, easeOut, linear, track, type Frame } from '@/lib/motion-track';
import { fonts, radius, useTheme } from '@/lib/theme';
import Materials, { GLINT, SHADOW_INK, STEEL_DARK, STEEL_SOFT } from './materials';
import { ArtStage, Layer, useStage } from './stage';

/**
 * The estate map (onboarding "Where are you?", docs/mockups/onboarding-motion.html screen 05), a 12 s loop on a
 * 264 × 180 view box: a blueprint of an industrial estate; an overhead crane's trolley runs in on the gantry, its cable
 * stretches and the hook lowers the pin onto the highlighted plot, which lands with a ring; the plot label slides out;
 * three range rings open, one radar sweep turns and each business pings as the sweep passes it; then it all fades and
 * loops. The label shows the business's own industrial area and pincode (none until one is set).
 */

const VB = [264, 180] as const;
const LOOP_MS = 12000;
/** The finished frame: pin set, label out, rings open, every ping lit, the crane gone. */
const REST = 0.8;
const [CX, CY] = RADAR_CENTRE;

// lTrol, lCable (scaleY from the top), lHook, lPin: glide.
const TROLLEY_X: Frame[] = [[0, 150], [3, 150], [16, 0], [40, 0], [50, -160], [100, -160]];
const CABLE: Frame[] = [[0, 1], [17, 1], [28, 6], [30, 6], [38, 1], [100, 1]];
const HOOK_Y: Frame[] = [[0, 0], [17, 0], [28, 60], [30, 60], [38, 0], [100, 0]];
const PIN_X: Frame[] = [[0, 150], [3, 150], [16, 0], [100, 0]];
const PIN_Y: Frame[] = [[0, -60], [17, -60], [28, 0], [100, 0]];
const PIN_O: Frame[] = [[0, 1], [88, 1], [94, 0], [100, 0]];
// lLand: ease-out.
const LAND_O: Frame[] = [[0, 0], [27.5, 0], [28.5, 0.9], [37, 0], [100, 0]];
const LAND_S: Frame[] = [[0, 0.6], [27.5, 0.6], [28.5, 0.8], [37, 2.4], [100, 2.4]];
// lLabel.
const LABEL_O: Frame[] = [[0, 0], [37, 0], [41, 1], [88, 1], [94, 0], [100, 0]];
const LABEL_X: Frame[] = [[0, -6], [37, -6], [41, 0], [100, 0]];
// lRing, each 0.15 s after the last.
const RING_S: Frame[] = [[0, 0.15], [44, 0.15], [58, 1], [100, 1]];
const RING_O: Frame[] = [[0, 0], [44, 0], [47, 0.9], [58, 0.55], [88, 0.55], [94, 0], [100, 0]];
const RINGS = [40, 75, 110] as const;
const RING_STAGGER = (150 / LOOP_MS) * 100;
// lSweep: linear.
const SWEEP_R: Frame[] = [[0, -30], [46, -30], [70, 330], [100, 330]];
const SWEEP_O: Frame[] = [[0, 0], [45, 0], [46, 1], [70, 1], [72, 0], [100, 0]];
const PING_TRACKS = PINGS.map(([x, y]) => pingTracks(x, y));

const PLOTS = [
  [8, 8, 38, 36], [50, 8, 40, 36], [8, 48, 82, 46], [8, 114, 36, 30], [48, 114, 42, 30], [8, 148, 82, 28],
  [108, 8, 74, 38], [108, 50, 34, 44], [146, 50, 36, 44], [152, 114, 30, 30], [108, 148, 74, 28],
  [200, 8, 56, 40], [200, 52, 56, 42], [200, 114, 56, 28], [200, 146, 56, 30],
] as const;
const LABEL = { x: 140, y: 99, height: 15, padX: 6, maxWidth: 104, size: 6.6, minSize: 5 };

/** `#RRGGBB` at an opacity, for the blueprint's faint lines. */
function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

interface EstateMapProps {
  /** The plot label (area and pincode), or null for none. */
  label: string | null;
  style?: StyleProp<ViewStyle>;
}

export default function EstateMap({ label, style }: EstateMapProps) {
  const { colors } = useTheme();
  const t = useLoop(LOOP_MS, REST);
  const [width, setWidth] = useState(0);

  const s = useMemo(() => StyleSheet.create({
    card: {
      width: '100%', aspectRatio: VB[0] / VB[1], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline,
      backgroundColor: colors.surface, overflow: 'hidden',
    },
  }), [colors]);

  const grid = withAlpha(colors.primary, 0.07);
  const plotLine = withAlpha(colors.primary, 0.22);
  const fit = useMemo(() => (label ? fitMonoText(label, LABEL) : null), [label]);

  return (
    <View style={[s.card, style]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 2)}>
      {width > 0 ? (
        <ArtStage vb={VB} width={width}>
          <Layer>
            <Materials use={['grid']} gridColor={grid} />
            <Rect width={VB[0]} height={VB[1]} fill="url(#p-grid)" />
            <Rect x={0} y={98} width={264} height={12} fill={colors.field} />
            <Rect x={94} y={0} width={10} height={180} fill={colors.field} />
            <Rect x={186} y={0} width={10} height={180} fill={colors.field} />
            <Line x1={0} y1={104} x2={264} y2={104} stroke={colors.textMuted} strokeWidth={0.7} strokeDasharray="5 4" opacity={0.6} />
            {PLOTS.map(([x, y, w, h], i) => (
              <Rect key={i} x={x} y={y} width={w} height={h} rx={2} fill={colors.primaryWash} stroke={plotLine} strokeWidth={0.8} />
            ))}
            <Rect x={108} y={114} width={40} height={30} rx={2} fill={colors.primarySoft} stroke={colors.primary} strokeWidth={1.2} />
            <SvgText x={112} y={140} fontFamily={fonts.monoMedium} fontSize={6.5} fill={colors.primaryInk}>214</SvgText>
          </Layer>
          {RINGS.map((r, i) => <Ring key={r} t={t} r={r} delayPct={i * RING_STAGGER} />)}
          <Sweep t={t} />
          {PINGS.map(([x, y], i) => <Ping key={i} t={t} x={x} y={y} tracks={PING_TRACKS[i]} />)}
          <Landing t={t} />
          {fit && fit.text ? <Label t={t} text={fit.text} fontSize={fit.fontSize} textWidth={fit.width} /> : null}
          <Pin t={t} />
          <Layer>
            <Materials use={['chrome']} />
            <Rect x={0} y={2} width={264} height={5} fill="url(#g-chrome)" />
          </Layer>
          <Trolley t={t} />
        </ArtStage>
      ) : null}
    </View>
  );
}

function Ring({ t, r, delayPct }: { t: SharedValue<number>; r: number; delayPct: number }) {
  const { colors } = useTheme();
  const open = useAnimatedStyle(() => {
    const pct = Math.max(0, t.value * 100 - delayPct);
    return { opacity: track(pct, RING_O, EASE.glide), transform: [{ scale: track(pct, RING_S, EASE.glide) }] };
  });
  return (
    <Layer style={open} origin={RADAR_CENTRE}>
      <Circle cx={CX} cy={CY} r={r} fill="none" stroke={colors.primary} strokeWidth={1} strokeDasharray="3 3" />
    </Layer>
  );
}

function Sweep({ t }: { t: SharedValue<number> }) {
  const { colors } = useTheme();
  const turn = useAnimatedStyle(() => {
    const pct = t.value * 100;
    return { opacity: track(pct, SWEEP_O, linear), transform: [{ rotate: `${track(pct, SWEEP_R, linear)}deg` }] };
  });
  return (
    <Layer style={turn} origin={RADAR_CENTRE}>
      <Path d="M128 124 L128 14 A110 110 0 0 1 183 28.7 Z" fill={colors.primary} opacity={0.16} />
      <Line x1={128} y1={124} x2={183} y2={28.7} stroke={colors.primary} strokeWidth={1.4} opacity={0.7} />
    </Layer>
  );
}

/** A business pinged by the sweep: a yellow dot in a soft halo. */
function Ping({ t, x, y, tracks }: { t: SharedValue<number>; x: number; y: number; tracks: ReturnType<typeof pingTracks> }) {
  const { colors } = useTheme();
  const { k } = useStage();
  const light = useAnimatedStyle(() => {
    const pct = t.value * 100;
    return { opacity: track(pct, tracks.opacity), transform: [{ scale: track(pct, tracks.scale) }] };
  });
  const box: ViewStyle = { position: 'absolute', left: (x - 8) * k, top: (y - 8) * k, width: 16 * k, height: 16 * k };
  const halo: ViewStyle = { ...StyleSheet.absoluteFillObject, borderRadius: 8 * k, backgroundColor: colors.sun, opacity: 0.25 };
  const dot: ViewStyle = {
    position: 'absolute', left: 3.8 * k, top: 3.8 * k, width: 8.4 * k, height: 8.4 * k, borderRadius: 4.2 * k,
    backgroundColor: colors.sun, borderWidth: 1.2 * k, borderColor: SHADOW_INK,
  };
  return (
    <Animated.View style={[box, light]}>
      <View style={halo} />
      <View style={dot} />
    </Animated.View>
  );
}

function Landing({ t }: { t: SharedValue<number> }) {
  const { colors } = useTheme();
  const ring = useAnimatedStyle(() => {
    const pct = t.value * 100;
    return { opacity: track(pct, LAND_O, easeOut), transform: [{ scale: track(pct, LAND_S, easeOut) }] };
  });
  return (
    <Layer style={ring} origin={RADAR_CENTRE}>
      <Ellipse cx={CX} cy={CY} rx={10} ry={4} fill="none" stroke={colors.primary} strokeWidth={1.5} />
    </Layer>
  );
}

function Label({ t, text, fontSize, textWidth }: { t: SharedValue<number>; text: string; fontSize: number; textWidth: number }) {
  const { colors } = useTheme();
  const { k } = useStage();
  const out = useAnimatedStyle(() => {
    const pct = t.value * 100;
    return { opacity: track(pct, LABEL_O, EASE.glide), transform: [{ translateX: track(pct, LABEL_X, EASE.glide) * k }] };
  });
  const w = textWidth + 2 * LABEL.padX;
  return (
    <Layer style={out}>
      <Rect
        x={LABEL.x} y={LABEL.y} width={w} height={LABEL.height} rx={LABEL.height / 2}
        fill={colors.surface} stroke={colors.border}
      />
      <SvgText
        x={LABEL.x + LABEL.padX} y={LABEL.y + LABEL.height / 2 + fontSize * 0.42}
        fontFamily={fonts.monoMedium} fontSize={fontSize} fill={colors.text}
      >
        {text}
      </SvgText>
    </Layer>
  );
}

function Pin({ t }: { t: SharedValue<number> }) {
  const { colors } = useTheme();
  const { k } = useStage();
  const carry = useAnimatedStyle(() => {
    const pct = t.value * 100;
    return {
      opacity: track(pct, PIN_O, EASE.glide),
      transform: [{ translateX: track(pct, PIN_X, EASE.glide) * k }, { translateY: track(pct, PIN_Y, EASE.glide) * k }],
    };
  });
  return (
    <Layer style={carry}>
      <Ellipse cx={CX} cy={CY} rx={5} ry={1.8} fill={SHADOW_INK} opacity={0.25} />
      <Path d="M128 124 C122 117 118.5 112 118.5 106 A9.5 9.5 0 1 1 137.5 106 C137.5 112 134 117 128 124 Z" fill={colors.primary} />
      <Circle cx={128} cy={106} r={3.6} fill={GLINT} />
    </Layer>
  );
}

function Trolley({ t }: { t: SharedValue<number> }) {
  const { k } = useStage();
  const run = useAnimatedStyle(() => ({ transform: [{ translateX: track(t.value * 100, TROLLEY_X, EASE.glide) * k }] }));
  const cable = useAnimatedStyle(() => ({ transform: [{ scaleY: track(t.value * 100, CABLE, EASE.glide) }] }));
  const hook = useAnimatedStyle(() => ({ transform: [{ translateY: track(t.value * 100, HOOK_Y, EASE.glide) * k }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, run]}>
      <Layer style={cable} origin={[128, 10]}>
        <Rect x={127.3} y={10} width={1.4} height={12} fill={STEEL_DARK} />
      </Layer>
      <Layer style={hook}>
        <Path d="M128 22v6.5a4 4 0 1 1-4 4" fill="none" stroke={STEEL_DARK} strokeWidth={2} strokeLinecap="round" />
      </Layer>
      <Layer>
        <Materials use={['black']} />
        <Rect x={118} y={0} width={20} height={10} rx={2.5} fill="url(#g-black)" />
        <Circle cx={122} cy={10} r={1.6} fill={STEEL_SOFT} />
        <Circle cx={134} cy={10} r={1.6} fill={STEEL_SOFT} />
      </Layer>
    </Animated.View>
  );
}
