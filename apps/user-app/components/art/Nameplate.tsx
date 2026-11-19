import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { useLoop } from '@/hooks/use-loop';
import { useReducedMotion } from '@/lib/motion';
import { fitMonoText, type MonoFit } from '@/lib/mono-fit';
import { EASE, linear, track, type Frame } from '@/lib/motion-track';
import { fonts, useTheme } from '@/lib/theme';
import Materials, { GLINT, STEEL_INK, STEEL_MID } from './materials';
import { ArtStage, Layer, useStage } from './stage';

/**
 * The laser-engraved nameplate (onboarding "Your business", docs/mockups/onboarding-motion.html screen 04), a 12 s
 * loop on a 260 × 112 view box: a brushed-steel plate slides in under a chrome gantry, four rivets set one after
 * another, a laser head runs line 1 and then line 2 at an even speed with its beam and sparks, leaving the engraving
 * behind it, and the plate moves on down the line while a blank one follows.
 *
 * Line 1 is the business name (upper-cased), line 2 the person's name, both as typed. A new plate picks up the text at
 * the start of each loop, so typing never re-runs the laser mid-line; under reduce motion the finished plate shows the
 * text as it is typed.
 */

const VB = [260, 112] as const;
const LOOP_MS = 12000;
/** The finished frame: plate seated, both lines engraved, laser parked. */
const REST = 0.7;

/** The text's left edge, where the laser starts. */
const TEXT_X = 30;
const LINE1 = { baseline: 65, top: 44, bottom: 72, maxWidth: 200, size: 12.5, minSize: 7 };
const LINE2 = { baseline: 85, top: 73, bottom: 92, maxWidth: 200, size: 8.5, minSize: 6.5 };
/** The clip window's width: the widest a line can be, plus the highlight. */
const CLIP_W = 204;
const LINE2_INK = '#6A6E79';
const PLATE_EDGE = '#A9ADB6';

// bPlate: in from the right, seated, out to the left.
const PLATE_X: Frame[] = [[0, 290], [7, 0], [86, 0], [95, -290], [100, -290]];
// bRivet (seat), each 0.08 s after the last.
const RIVET: Frame[] = [[0, 0], [7, 0], [9.5, 1], [100, 1]];
const RIVETS = [[25, 39], [235, 39], [25, 95], [235, 95]] as const;
const RIVET_STAGGER = (80 / LOOP_MS) * 100;
// bT1 / bT2: the engraving revealed behind the laser (linear).
const REVEAL1: Frame[] = [[0, 0], [12, 0], [34, 1], [100, 1]];
const REVEAL2: Frame[] = [[0, 0], [38, 0], [50, 1], [100, 1]];
// bLaser, as a fraction of each line's width: rail while parked, linear along the line, glide back.
const LASER1: Frame[] = [[0, 0, EASE.rail], [12, 0, linear], [34, 1, EASE.glide], [37, 0]];
const LASER2: Frame[] = [[37, 0, linear], [38, 0, linear], [50, 1, EASE.glide], [58, 0], [100, 0]];
// bBeam1 / bBeam2.
const BEAM1: Frame[] = [[0, 0], [11.9, 0], [12, 1], [33.9, 1], [34, 0], [100, 0]];
const BEAM2: Frame[] = [[0, 0], [37.9, 0], [38, 1], [49.9, 1], [50, 0], [100, 0]];

/** Sparks under each beam: [cx, cy, r, flicker period in ms] (mockup `flick`, .18 s and .26 s). */
const SPARKS1 = [[26, 55, 0.9, 260], [35, 56, 0.8, 180], [33, 52, 0.7, 260]] as const;
const SPARKS2 = [[27, 78, 0.8, 260], [34, 77, 0.7, 180]] as const;

interface NameplateProps {
  /** The business name as typed. */
  line1: string;
  /** The person's name as typed. */
  line2: string;
  style?: StyleProp<ViewStyle>;
}

export default function Nameplate({ line1, line2, style }: NameplateProps) {
  const reduced = useReducedMotion();
  const t = useLoop(LOOP_MS, REST);
  const [width, setWidth] = useState(0);

  // The plate on the line keeps the text it came in with; the next plate takes the latest.
  const latest = useRef({ line1, line2 });
  latest.current = { line1, line2 };
  const [latched, setLatched] = useState({ line1, line2 });
  const relatch = useCallback(() => {
    const next = latest.current;
    setLatched((cur) => (cur.line1 === next.line1 && cur.line2 === next.line2 ? cur : next));
  }, []);
  useAnimatedReaction(
    () => t.value,
    (cur, prev) => {
      if (prev !== null && cur < prev) scheduleOnRN(relatch);
    },
  );

  const text = reduced ? { line1, line2 } : latched;
  const fit1 = useMemo(() => fitMonoText(text.line1.toUpperCase(), LINE1), [text.line1]);
  const fit2 = useMemo(() => fitMonoText(text.line2, LINE2), [text.line2]);

  const s = useMemo(() => StyleSheet.create({ box: { width: '100%', aspectRatio: VB[0] / VB[1] } }), []);

  return (
    <View style={[s.box, style]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ArtStage vb={VB} width={width}>
          <Plate t={t} fit1={fit1} fit2={fit2} />
          <Layer>
            <Materials use={['chrome']} />
            <Rect x={4} y={4} width={252} height={6} rx={3} fill="url(#g-chrome)" />
          </Layer>
          <Laser t={t} w1={fit1.width} w2={fit2.width} />
        </ArtStage>
      ) : null}
    </View>
  );
}

function Plate({ t, fit1, fit2 }: { t: SharedValue<number>; fit1: MonoFit; fit2: MonoFit }) {
  const { k } = useStage();
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: track(t.value * 100, PLATE_X, EASE.glide) * k }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, slide]}>
      <Layer>
        <Materials use={['brush', 'brushLines']} />
        <Rect x={14} y={28} width={232} height={78} rx={7} fill="url(#g-brush)" stroke={STEEL_MID} strokeWidth={0.8} />
        <Rect x={14} y={28} width={232} height={78} rx={7} fill="url(#p-brush)" />
        <Rect x={19} y={33} width={222} height={68} rx={4} fill="none" stroke={PLATE_EDGE} strokeWidth={0.7} />
      </Layer>
      {RIVETS.map(([cx, cy], i) => <Rivet key={i} t={t} cx={cx} cy={cy} delayPct={i * RIVET_STAGGER} />)}
      <Engraving t={t} line={LINE1} fit={fit1} reveal={REVEAL1}>
        <SvgText x={TEXT_X} y={LINE1.baseline + 0.6} fontFamily={fonts.monoMedium} fontSize={fit1.fontSize} fill={GLINT} opacity={0.75}>
          {fit1.text}
        </SvgText>
        <SvgText x={TEXT_X} y={LINE1.baseline} fontFamily={fonts.monoMedium} fontSize={fit1.fontSize} fill={STEEL_INK}>
          {fit1.text}
        </SvgText>
      </Engraving>
      <Engraving t={t} line={LINE2} fit={fit2} reveal={REVEAL2}>
        <SvgText x={TEXT_X} y={LINE2.baseline} fontFamily={fonts.monoMedium} fontSize={fit2.fontSize} fill={LINE2_INK}>
          {fit2.text}
        </SvgText>
      </Engraving>
    </Animated.View>
  );
}

function Rivet({ t, cx, cy, delayPct }: { t: SharedValue<number>; cx: number; cy: number; delayPct: number }) {
  const set = useAnimatedStyle(() => {
    const v = track(Math.max(0, t.value * 100 - delayPct), RIVET, EASE.seat);
    return { opacity: Math.min(1, Math.max(0, v)), transform: [{ scale: Math.max(0, v) }] };
  });
  return (
    <Layer style={set} origin={[cx, cy]}>
      <Materials use={['ball']} />
      <Circle cx={cx} cy={cy} r={3.3} fill="url(#g-ball)" />
    </Layer>
  );
}

/**
 * One engraved line, revealed left to right behind the laser with a transform-only clip: the window slides left and
 * its content right by the same amount, so the window shows [TEXT_X, TEXT_X + f × width].
 */
function Engraving({ t, line, fit, reveal, children }: {
  t: SharedValue<number>;
  line: typeof LINE1;
  fit: MonoFit;
  reveal: Frame[];
  children: React.ReactNode;
}) {
  const { k, vbW, vbH } = useStage();
  const x0 = TEXT_X - 1;
  const w = fit.width + 1;
  const offset = (f: number) => {
    'worklet';
    return f >= 1 ? 0 : (CLIP_W - f * w) * k;
  };
  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -offset(track(t.value * 100, reveal)) }] }));
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset(track(t.value * 100, reveal)) }] }));
  if (!fit.text) return null;
  const box: ViewStyle = {
    position: 'absolute', left: x0 * k, top: line.top * k, width: CLIP_W * k, height: (line.bottom - line.top) * k,
    overflow: 'hidden',
  };
  const content: ViewStyle = { position: 'absolute', left: -x0 * k, top: -line.top * k, width: vbW * k, height: vbH * k };
  return (
    <Animated.View style={[box, windowStyle]}>
      <Animated.View style={[content, contentStyle]}>
        <Layer>{children}</Layer>
      </Animated.View>
    </Animated.View>
  );
}

function Laser({ t, w1, w2 }: { t: SharedValue<number>; w1: number; w2: number }) {
  const { colors } = useTheme();
  const { k } = useStage();
  const run = useAnimatedStyle(() => {
    const pct = t.value * 100;
    const x = pct < 37 ? track(pct, LASER1) * w1 : track(pct, LASER2) * w2;
    return { transform: [{ translateX: x * k }] };
  });
  // A line with nothing to engrave fires no beam.
  const beam1 = useAnimatedStyle(() => ({ opacity: w1 > 0 ? track(t.value * 100, BEAM1) : 0 }));
  const beam2 = useAnimatedStyle(() => ({ opacity: w2 > 0 ? track(t.value * 100, BEAM2) : 0 }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, run]}>
      <Animated.View style={[StyleSheet.absoluteFill, beam1]}>
        <Layer>
          <Line x1={30} y1={14} x2={30} y2={58} stroke={colors.primary} strokeWidth={5} opacity={0.18} />
          <Line x1={30} y1={14} x2={30} y2={58} stroke={colors.primary} strokeWidth={1.3} />
          <Circle cx={30} cy={59} r={2.6} fill={GLINT} stroke={colors.primary} strokeWidth={1.2} />
        </Layer>
        {SPARKS1.map(([cx, cy, r, period], i) => <Spark key={i} t={t} cx={cx} cy={cy} r={r} period={period} />)}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, beam2]}>
        <Layer>
          <Line x1={30} y1={14} x2={30} y2={80} stroke={colors.primary} strokeWidth={5} opacity={0.18} />
          <Line x1={30} y1={14} x2={30} y2={80} stroke={colors.primary} strokeWidth={1.3} />
          <Circle cx={30} cy={81} r={2.2} fill={GLINT} stroke={colors.primary} strokeWidth={1.1} />
        </Layer>
        {SPARKS2.map(([cx, cy, r, period], i) => <Spark key={i} t={t} cx={cx} cy={cy} r={r} period={period} />)}
      </Animated.View>
      <Layer>
        <Materials use={['black']} />
        <Rect x={21} y={1} width={18} height={13} rx={3} fill="url(#g-black)" />
        <Circle cx={30} cy={7.5} r={2} fill={colors.primary} />
      </Layer>
    </Animated.View>
  );
}

/** A yellow spark flickering under the beam (mockup `flick`: steps(2), alternate). */
function Spark({ t, cx, cy, r, period }: { t: SharedValue<number>; cx: number; cy: number; r: number; period: number }) {
  const { colors } = useTheme();
  const { k } = useStage();
  const flick = useAnimatedStyle(() => {
    const step = Math.floor((t.value * LOOP_MS) / (period / 2)) % 4;
    return { opacity: step === 0 ? 1 : step === 2 ? 0.15 : 0.575 };
  });
  const dot: ViewStyle = {
    position: 'absolute', left: (cx - r) * k, top: (cy - r) * k, width: 2 * r * k, height: 2 * r * k,
    borderRadius: r * k, backgroundColor: colors.sun,
  };
  return <Animated.View style={[dot, flick]} />;
}
