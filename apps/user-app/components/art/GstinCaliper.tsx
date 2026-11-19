import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { Circle, Line, Path, Rect } from 'react-native-svg';
import { ArtStage, Layer } from '@/components/art/stage';
import Materials from '@/components/art/materials';
import { useType } from '@/hooks/use-type';
import { readCaliper, GSTIN_LENGTH, type CaliperCell } from '@/lib/gstin-caliper';
import { Check } from '@/lib/icons';
import { useReducedMotion } from '@/lib/motion';
import { EASE } from '@/lib/motion-track';
import { fonts, radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';

// The GSTIN caliper (onboarding motion mockup, screen "06 GST": `.gwrap`, `.gst .gc`, `.jaw`, `.readout`, `.tol` and
// the SVG under `#p-gst`). A vernier caliper over the 15 character cells reads what the user types into the GSTIN
// field below it: the jaws span the part being typed (750 ms rail move), the part's cells light up, complete parts
// that are well formed get a green underline, and a valid GSTIN opens the jaws to the full span and seats the
// tolerance tick. State comes from `readCaliper` (lib/gstin-caliper.ts). Decorative: the Input stays the
// accessible control, so the whole instrument is hidden from screen readers.

/** The mockup's character cell (15 px), and its drawing shifted right by the jaw's width so nothing overhangs. */
const CW = 15;
const OFF = 9;
const VB_W = GSTIN_LENGTH * CW + 2 * OFF;
const VB_H = 50;
/** Mockup → app scale (spec R1). */
const SCALE = 1.15;
/** Cells sit under the beam (the mockup's `.gwrap` padding-top) and are 26 high plus a 2 high underline. */
const CELL_TOP = 20;
const CELL_H = 26;
const LINE_H = 2;

/** The caliper's metal and LCD colours: illustration materials, the same in both themes. */
const TICK = '#5E626C';
const LCD = '#C9D3C0';
const LCD_INK = '#1E2B1E';

/** Scale ticks every 5 units, long every 15 (one per character). */
const TICKS = Array.from({ length: (GSTIN_LENGTH * CW) / 5 + 1 }, (_, i) => i * 5);

const JAW_MS = 750;

interface GstinCaliperProps {
  /** The GSTIN field's raw text. */
  text: string;
  style?: StyleProp<ViewStyle>;
}

export default function GstinCaliper({ text, style }: GstinCaliperProps) {
  const { colors } = useTheme();
  const type = useType();
  const reduced = useReducedMotion();
  const { width: windowW } = useWindowDimensions();
  const reading = useMemo(() => readCaliper(text), [text]);

  // The screen's 16 dp padding and the box's own padding on each side; never wider than the mockup × 1.15.
  const stageW = Math.min(VB_W * SCALE, windowW - 2 * spacing.lg - 2 * spacing.md);
  const k = stageW / VB_W;

  const [a, b] = reading.jaws;
  const ja = useSharedValue(a);
  const jb = useSharedValue(b);
  useEffect(() => {
    if (reduced) {
      ja.value = a;
      jb.value = b;
      return;
    }
    ja.value = withTiming(a, { duration: JAW_MS, easing: EASE.rail });
    jb.value = withTiming(b, { duration: JAW_MS, easing: EASE.rail });
  }, [a, b, reduced, ja, jb]);
  const jawA = useAnimatedStyle(() => ({ transform: [{ translateX: ja.value * CW * k }] }));
  const jawB = useAnimatedStyle(() => ({ transform: [{ translateX: jb.value * CW * k }] }));

  // "Within tolerance" seats once the jaws have opened to the full span (mockup: +650 ms, 450 ms glide).
  const tol = useSharedValue(reading.valid ? 1 : 0);
  useEffect(() => {
    const target = reading.valid ? 1 : 0;
    if (reduced || !reading.valid) tol.value = reduced ? target : withTiming(0, { duration: 200 });
    else tol.value = withDelay(650, withTiming(1, { duration: 450, easing: EASE.glide }));
  }, [reading.valid, reduced, tol]);
  const tolStyle = useAnimatedStyle(() => ({ opacity: tol.value, transform: [{ translateY: 5 * (1 - tol.value) }] }));

  // The readout blinks as it changes part (mockup `.readout.fade`).
  const blink = useSharedValue(1);
  useEffect(() => {
    if (reduced || reading.part === null) return;
    blink.value = withSequence(withTiming(0.25, { duration: 90 }), withTiming(1, { duration: 180 }));
  }, [reading.part, reduced, blink]);
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const s = useMemo(() => StyleSheet.create({
    box: {
      borderRadius: radius.md, backgroundColor: colors.field,
      paddingTop: spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm,
    },
    cells: { position: 'absolute', left: OFF * k, top: CELL_TOP * k, flexDirection: 'row' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    readout: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 34,
      borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: LCD,
    },
    count: {
      ...type('mono'), fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 16, color: LCD,
      backgroundColor: LCD_INK, borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
    },
    groups: { ...type('mono'), fontFamily: fonts.monoMedium, fontSize: 13, lineHeight: 18, color: LCD_INK, flexShrink: 1 },
    tol: {
      paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.okSoft,
    },
  }), [colors, type, k]);

  return (
    <View style={[s.box, style]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <ArtStage vb={[VB_W, VB_H]} width={stageW}>
        <Layer>
          <Materials use={['chrome']} />
          <Rect x={OFF - 6} y={2} width={GSTIN_LENGTH * CW + 12} height={9} rx={2} fill="url(#g-chrome)" />
          {TICKS.map((x) => (
            <Line key={x} x1={OFF + x} y1={2} x2={OFF + x} y2={x % CW === 0 ? 8 : 5} stroke={TICK} strokeWidth={0.6} />
          ))}
        </Layer>
        <View style={s.cells}>
          {reading.cells.map((cell, i) => (
            // The 15 cells are fixed positions, so the index is their identity.
            <CaliperCellView key={i} cell={cell} k={k} colors={colors} reduced={reduced} />
          ))}
        </View>
        <Layer style={jawA}>
          <Materials use={['black']} />
          <Rect x={0} y={0} width={9} height={15} rx={2} fill="url(#g-black)" />
          <Path d={`M${OFF - 4} 15H${OFF}V44H${OFF - 1.5}Z`} fill="url(#g-black)" />
        </Layer>
        <Layer style={jawB}>
          <Materials use={['black']} />
          <Rect x={OFF} y={0} width={9} height={15} rx={2} fill="url(#g-black)" />
          <Circle cx={OFF + 4.5} cy={7.5} r={2} fill={colors.sun} />
          <Path d={`M${OFF} 15H${OFF + 4}L${OFF + 1.5} 44H${OFF}Z`} fill="url(#g-black)" />
        </Layer>
      </ArtStage>
      <View style={s.row}>
        <Animated.View style={[s.readout, blinkStyle]}>
          <Text style={s.count}>{`${reading.count}/${GSTIN_LENGTH}`}</Text>
          <Text style={s.groups} numberOfLines={1}>{reading.groups}</Text>
        </Animated.View>
        <Animated.View style={[s.tol, tolStyle]}>
          <Check size={17} color={colors.ok} strokeWidth={2.75} />
        </Animated.View>
      </View>
    </View>
  );
}

interface CellProps {
  cell: CaliperCell;
  /** Points per view-box unit. */
  k: number;
  colors: ThemeColors;
  reduced: boolean;
}

/** One character cell (`.gc`): lavender while measured (`.meas`), a green or red underline once read (`.ok`). */
function CaliperCellView({ cell, k, colors, reduced }: CellProps) {
  const meas = cell.state === 'meas';
  const lined = cell.state === 'ok' || cell.state === 'bad';
  // The underline keeps its last colour while it fades out.
  const lineColor = useRef(colors.ok);
  if (cell.state === 'ok') lineColor.current = colors.ok;
  if (cell.state === 'bad') lineColor.current = colors.danger;

  const hi = useSharedValue(meas ? 1 : 0);
  const line = useSharedValue(lined ? 1 : 0);
  useEffect(() => {
    hi.value = reduced ? (meas ? 1 : 0) : withTiming(meas ? 1 : 0, { duration: 300 });
    line.value = reduced ? (lined ? 1 : 0) : withTiming(lined ? 1 : 0, { duration: 300 });
  }, [meas, lined, reduced, hi, line]);
  const hiStyle = useAnimatedStyle(() => ({ opacity: hi.value }));
  const lineStyle = useAnimatedStyle(() => ({ opacity: line.value }));

  const s = useMemo(() => StyleSheet.create({
    cell: { width: CW * k, height: (CELL_H + LINE_H) * k, alignItems: 'center' },
    hi: { position: 'absolute', left: 0, right: 0, top: 0, height: CELL_H * k, backgroundColor: colors.primarySoft },
    char: { fontFamily: fonts.monoMedium, fontSize: 17 * k, lineHeight: CELL_H * k, height: CELL_H * k, textAlign: 'center' },
    dotWrap: { height: CELL_H * k, justifyContent: 'center' },
    dot: { width: 3 * k, height: 3 * k, borderRadius: 2 * k, backgroundColor: colors.textMuted, opacity: 0.6 },
    line: { position: 'absolute', left: 0, right: 0, bottom: 0, height: LINE_H * k },
  }), [colors, k]);

  return (
    <View style={s.cell}>
      <Animated.View style={[s.hi, hiStyle]} />
      {cell.char ? (
        <Text style={[s.char, { color: meas ? colors.primaryInk : colors.text }]} allowFontScaling={false}>{cell.char}</Text>
      ) : (
        <View style={s.dotWrap}><View style={s.dot} /></View>
      )}
      <Animated.View style={[s.line, { backgroundColor: lineColor.current }, lineStyle]} />
    </View>
  );
}
