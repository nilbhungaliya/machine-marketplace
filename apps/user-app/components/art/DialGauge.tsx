import React, { useEffect } from 'react';
import { Circle, Ellipse, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ArtStage, Layer } from '@/components/art/stage';
import Materials, { GLINT, STEEL_MID, STEEL_SOFT } from '@/components/art/materials';
import { useReducedMotion } from '@/lib/motion';
import { cubicBezier, easeOut } from '@/lib/motion-track';
import { fonts, useTheme } from '@/lib/theme';

// 02 Mobile number (docs/mockups/onboarding-motion.html, `.gauge`): a pressure gauge that reads how many digits of
// the number are in. The needle steps 24° per digit with one small settle; the lamp turns green at 10.

export const GAUGE_VB = [200, 170] as const;
const PIVOT = [100, 86] as const;
const MAX = 10;

/** The needle's transition: `cubic-bezier(.3,1.45,.5,1)`, 550 ms (one small overshoot, then it sits). */
const SETTLE = cubicBezier(0.3, 1.45, 0.5, 1);
const NEEDLE_MS = 550;
const LAMP_MS = 300;

const needleAngle = (digits: number) => -120 + 24 * digits;

/** Ticks 0–10 (and a half tick after each but the last) with their numbers, as the mockup's script draws them. */
const TICKS = Array.from({ length: MAX + 1 }, (_, k) => {
  const a = (needleAngle(k) * Math.PI) / 180;
  const s = Math.sin(a);
  const c = -Math.cos(a);
  const m = a + (12 * Math.PI) / 180;
  return {
    k,
    major: { x1: 100 + 58 * s, y1: 86 + 58 * c, x2: 100 + 66 * s, y2: 86 + 66 * c },
    minor: k < MAX
      ? { x1: 100 + 62 * Math.sin(m), y1: 86 - 62 * Math.cos(m), x2: 100 + 66 * Math.sin(m), y2: 86 - 66 * Math.cos(m) }
      : null,
    label: { x: (100 + 47 * s).toFixed(1), y: (86 + 47 * c + 3).toFixed(1) },
  };
});

interface DialGaugeProps {
  /** Digits of the mobile number entered, 0–10. */
  digits: number;
  /** Drawn width in points. */
  width: number;
}

/** Decorative: ArtStage hides it from screen readers. Under reduce motion the needle and lamp jump to the reading. */
export default function DialGauge({ digits, width }: DialGaugeProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const n = Math.max(0, Math.min(MAX, Math.round(digits)));
  const full = n === MAX;

  const angle = useSharedValue(needleAngle(n));
  const lamp = useSharedValue(full ? 1 : 0);

  useEffect(() => {
    const to = needleAngle(n);
    angle.value = reduced ? to : withTiming(to, { duration: NEEDLE_MS, easing: SETTLE });
  }, [n, reduced, angle]);

  useEffect(() => {
    const to = full ? 1 : 0;
    lamp.value = reduced ? to : withTiming(to, { duration: LAMP_MS, easing: easeOut });
  }, [full, reduced, lamp]);

  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  const lampStyle = useAnimatedStyle(() => ({ opacity: lamp.value }));

  return (
    <ArtStage vb={GAUGE_VB} width={width}>
      {/* Body: shadow, chrome bezel, face, the green band near 10, the scale and the unlit lamp. */}
      <Layer>
        <Materials use={['chrome', 'shadow']} />
        <Ellipse cx={100} cy={164} rx={60} ry={5} fill="url(#g-sh)" />
        <Circle cx={100} cy={86} r={76} fill="url(#g-chrome)" />
        <Circle cx={100} cy={86} r={69} fill={colors.surface} stroke={STEEL_MID} strokeWidth={1} />
        <Path d="M 157.9 119.4 A 66 66 0 0 0 165.2 75" fill="none" stroke={colors.ok} strokeWidth={5} opacity={0.35} />
        <G>
          {TICKS.map((t) => (
            <G key={t.k}>
              <Line {...t.major} stroke={colors.textSecondary} strokeWidth={1.6} strokeLinecap="round" />
              {t.minor ? <Line {...t.minor} stroke={colors.textMuted} strokeWidth={1} /> : null}
              <SvgText
                x={t.label.x}
                y={t.label.y}
                textAnchor="middle"
                fontFamily={fonts.monoMedium}
                fontSize={8}
                fill={colors.textSecondary}
              >
                {String(t.k)}
              </SvgText>
            </G>
          ))}
        </G>
        <Circle cx={100} cy={112} r={4.2} fill={colors.border} />
      </Layer>
      {/* The lamp lit: fades in over the unlit one at 10 digits. */}
      <Layer style={lampStyle}>
        <Circle cx={100} cy={112} r={4.2} fill={colors.ok} />
      </Layer>
      <Layer style={needleStyle} origin={PIVOT}>
        <Path d="M98.2 86 L100 30 L101.8 86 Z" fill={colors.primary} />
        <Path d="M99 86h2v14h-2z" fill={colors.primary} />
      </Layer>
      {/* Hub cap and the bezel's glint sit over the needle. */}
      <Layer>
        <Materials use={['black']} />
        <Circle cx={100} cy={86} r={7} fill="url(#g-black)" />
        <Circle cx={100} cy={86} r={2.4} fill={STEEL_SOFT} />
        <Path d="M44 58A62 62 0 0 1 84 26" stroke={GLINT} strokeOpacity={0.8} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      </Layer>
    </ArtStage>
  );
}
