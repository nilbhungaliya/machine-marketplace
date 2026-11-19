import React from 'react';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import Materials, { BORE, GLINT, STEEL_EDGE, STEEL_MID, STEEL_SOFT } from '@/components/art/materials';
import { ArtStage, Layer, useStage } from '@/components/art/stage';
import { EASE, cubicBezier, easeOut, linear, track, type Frame } from '@/lib/motion-track';
import { fonts, useTheme } from '@/lib/theme';

/**
 * 01 Welcome, "Exploded hub assembly" (docs/mockups/onboarding-motion.html, `.w-*`): the 22-tooth gear glides in from
 * the left, the bearing from the right (its ten balls turning), the hub from above, five bolts close in radially, a
 * ring flashes as the assembly seats, the dimension line draws, the gear ratchets three teeth, then everything backs
 * out along the same lines. One 10 s loop (`HUB_LOOP_MS`), shared with `MatchToken` so the token finds its right half
 * on the same clock. Rest frame (`HUB_REST`): assembled, measured, ticked.
 */

export const HUB_LOOP_MS = 10_000;
/** The loop position shown under reduce motion and while the screen is hidden: everything seated, R found. */
export const HUB_REST = 0.75;

const VB = [260, 196] as const;
const CX = 130;
const CY = 90;
const CENTRE = [CX, CY] as const;

/** The mockup's gear: 22 trapezoid teeth, root radius 49, tip radius 56. */
const GEAR_PATH = (() => {
  const n = 22;
  const st = (2 * Math.PI) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = i * st - Math.PI / 2;
    ([[49, -0.27], [56, -0.13], [56, 0.13], [49, 0.27]] as const).forEach(([r, f], k) => {
      const a = t + f * st;
      d += (i === 0 && k === 0 ? 'M' : 'L') + (CX + r * Math.cos(a)).toFixed(2) + ' ' + (CY + r * Math.sin(a)).toFixed(2);
    });
  }
  return d + 'Z';
})();

/** Ten bearing balls on radius 23, the first at the top. */
const BALLS = Array.from({ length: 10 }, (_, k) => {
  const a = (k * Math.PI) / 5 - Math.PI / 2;
  return { cx: CX + 23 * Math.cos(a), cy: CY + 23 * Math.sin(a) };
});

/** Five hex bolts on radius 38.7; each starts 62 units further out along its own spoke, 0.1 s after the last. */
const BOLTS = Array.from({ length: 5 }, (_, k) => {
  const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
  const x = CX + 38.7 * Math.cos(a);
  const y = CY + 38.7 * Math.sin(a);
  let hex = '';
  for (let j = 0; j < 6; j++) {
    const b = (j * Math.PI) / 3;
    hex += (j ? 'L' : 'M') + (x + 3.9 * Math.cos(b)).toFixed(2) + ' ' + (y + 3.9 * Math.sin(b)).toFixed(2);
  }
  return { x, y, hex: hex + 'Z', dx: 62 * Math.cos(a), dy: 62 * Math.sin(a), lag: k * 0.01 };
});

// Keyframes (mockup @keyframes w*), translated to [percent, value].
const GEAR_X: readonly Frame[] = [[0, -170], [4, -170], [16, 0], [84, 0], [94, -170], [100, -170]];
const GEAR_O: readonly Frame[] = [[0, 0], [4, 0], [16, 1], [84, 1], [94, 0], [100, 0]];
/** wTick: three teeth (16.36° each); snaps back while the gear is out of sight. */
const TICK: readonly Frame[] = [
  [0, 0], [46, 0], [49, 16.36], [56, 16.36], [59, 32.73], [66, 32.73], [69, 49.09], [95, 49.09], [95.1, 0], [100, 0],
];
const TICK_EASE = cubicBezier(0.45, 0, 0.2, 1.45);
const BEAR_X: readonly Frame[] = [[0, 170], [10, 170], [22, 0], [86, 0], [95, 170], [100, 170]];
const BEAR_O: readonly Frame[] = [[0, 0], [10, 0], [22, 1], [86, 1], [95, 0], [100, 0]];
const BALLS_R: readonly Frame[] = [[0, 0], [30, 0], [86, 108], [100, 108]];
const HUB_Y: readonly Frame[] = [[0, -120], [18, -120], [28, 0], [88, 0], [96, -120], [100, -120]];
const HUB_O: readonly Frame[] = [[0, 0], [18, 0], [28, 1], [88, 1], [96, 0], [100, 0]];
/** wBolt: the share of the bolt's offset still to travel, and its opacity. */
const BOLT_OUT: readonly Frame[] = [[0, 1], [26, 1], [35, 0], [82, 0], [90, 1], [100, 1]];
const BOLT_O: readonly Frame[] = [[0, 0], [26, 0], [35, 1], [82, 1], [90, 0], [100, 0]];
const CLICK_O: readonly Frame[] = [[0, 0], [37, 0], [38, 0.9], [47, 0], [100, 0]];
const CLICK_S: readonly Frame[] = [[0, 0.9], [37, 0.9], [38, 0.94], [47, 1.16], [100, 1.16]];
const GUIDE_O: readonly Frame[] = [[0, 0], [5, 1], [30, 1], [42, 0], [100, 0]];
const DIM_O: readonly Frame[] = [[0, 0], [40, 0], [45, 1], [84, 1], [90, 0], [100, 0]];
/** wDimDraw (a stroke-dashoffset draw in the mockup) as a left-to-right reveal. */
const DIM_DRAW: readonly Frame[] = [[0, 0], [40, 0], [48, 1], [100, 1]];

/** The loop's percentage for a part that starts `lag` (0–1 of the loop) late: a CSS `animation-delay` on a loop. */
function lagged(t: number, lag: number): number {
  'worklet';
  const p = (t - lag) % 1;
  return (p < 0 ? p + 1 : p) * 100;
}

interface HubAssemblyProps {
  /** The shared loop clock: `useLoop(HUB_LOOP_MS, HUB_REST)`. */
  clock: SharedValue<number>;
  /** Drawn width in points. */
  width: number;
}

export default function HubAssembly({ clock, width }: HubAssemblyProps) {
  return (
    <ArtStage vb={VB} width={width}>
      <Parts clock={clock} />
    </ArtStage>
  );
}

function Parts({ clock }: { clock: SharedValue<number> }) {
  const { colors, isDark } = useTheme();
  const { k } = useStage();

  const guide = useAnimatedStyle(() => ({ opacity: track(clock.value * 100, GUIDE_O) }));
  const gear = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return {
      opacity: track(pct, GEAR_O, EASE.glide),
      transform: [
        { translateX: track(pct, GEAR_X, EASE.glide) * k },
        { rotate: `${track(pct, TICK, TICK_EASE)}deg` },
      ],
    };
  });
  const bear = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, BEAR_O, EASE.glide), transform: [{ translateX: track(pct, BEAR_X, EASE.glide) * k }] };
  });
  const balls = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return {
      opacity: track(pct, BEAR_O, EASE.glide),
      transform: [
        { translateX: track(pct, BEAR_X, EASE.glide) * k },
        { rotate: `${track(pct, BALLS_R, linear)}deg` },
      ],
    };
  });
  const hub = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, HUB_O, EASE.glide), transform: [{ translateY: track(pct, HUB_Y, EASE.glide) * k }] };
  });
  const click = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return { opacity: track(pct, CLICK_O, easeOut), transform: [{ scale: track(pct, CLICK_S, easeOut) }] };
  });
  const dim = useAnimatedStyle(() => ({ opacity: track(clock.value * 100, DIM_O) }));
  const dimDraw = useAnimatedStyle(() => {
    const pct = clock.value * 100;
    return {
      opacity: track(pct, DIM_O),
      transform: [{ scaleX: Math.max(0.001, track(pct, DIM_DRAW, EASE.rail)) }],
    };
  });

  return (
    <>
      {/* Blueprint grid and floor shadow: still. */}
      <Layer>
        <Materials use={['grid', 'shadow']} gridColor={colors.primary} />
        <Rect x={0} y={0} width={260} height={182} rx={20} fill="url(#p-grid)" opacity={isDark ? 0.09 : 0.07} />
        <Ellipse cx={130} cy={158} rx={62} ry={7} fill="url(#g-sh)" />
      </Layer>

      <Layer style={guide}>
        <G stroke={colors.primary} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} fill="none">
          <Line x1={-10} y1={90} x2={270} y2={90} />
          <Line x1={130} y1={-6} x2={130} y2={160} />
          <Circle cx={130} cy={90} r={70} />
        </G>
      </Layer>

      <Layer style={gear} origin={CENTRE}>
        <Materials use={['steel']} />
        <Path d={GEAR_PATH} fill="url(#g-steel)" stroke="#80848F" strokeWidth={0.6} />
        <Circle cx={130} cy={90} r={44.5} fill={STEEL_MID} />
        <Circle cx={130} cy={90} r={42.5} fill="url(#g-steel)" />
      </Layer>

      {/* The bearing's races; the balls turn on their own layer (they never overlap the inner race or the glint). */}
      <Layer style={bear}>
        <Materials use={['steel']} />
        <Circle cx={130} cy={90} r={34} fill="url(#g-steel)" stroke={STEEL_EDGE} strokeWidth={0.8} />
        <Circle cx={130} cy={90} r={28.5} fill="#7E828D" />
        <Circle cx={130} cy={90} r={17.5} fill="url(#g-steel)" />
        <Path d="M103 74A31 31 0 0 1 126 59.5" stroke={GLINT} strokeOpacity={0.75} strokeWidth={2} fill="none" strokeLinecap="round" />
      </Layer>
      <Layer style={balls} origin={CENTRE}>
        <Materials use={['ball']} />
        {BALLS.map((b) => <Circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={4.6} fill="url(#g-ball)" />)}
      </Layer>

      {BOLTS.map((b) => <Bolt key={b.hex} bolt={b} clock={clock} />)}

      <Layer style={hub}>
        <Materials use={['black']} />
        <Circle cx={130} cy={90} r={12} fill="url(#g-black)" />
        <Circle cx={130} cy={90} r={6.5} fill={BORE} />
        <Rect x={128.2} y={82} width={3.6} height={4} fill={BORE} />
      </Layer>

      <Layer style={click} origin={CENTRE}>
        <Circle cx={130} cy={90} r={60} fill="none" stroke={colors.primary} strokeWidth={2} />
      </Layer>

      <Layer style={dim}>
        <G stroke={colors.textMuted} strokeWidth={1} fill="none">
          <Line x1={74} y1={152} x2={74} y2={178} />
          <Line x1={186} y1={152} x2={186} y2={178} />
        </G>
        <Rect x={104} y={180} width={52} height={14} rx={7} fill={colors.background} />
        <SvgText
          x={130}
          y={190.5}
          textAnchor="middle"
          fontFamily={fonts.monoMedium}
          fontSize={9}
          fill={colors.textSecondary}
        >
          Ø112 · 22T
        </SvgText>
      </Layer>
      <Layer style={dimDraw} origin={[76, 172]}>
        <Path
          d="M76 172H184M76 172l5 -3M76 172l5 3M184 172l-5 -3M184 172l-5 3"
          stroke={colors.textMuted}
          strokeWidth={1}
          fill="none"
        />
      </Layer>
    </>
  );
}

function Bolt({ bolt, clock }: { bolt: (typeof BOLTS)[number]; clock: SharedValue<number> }) {
  const { k } = useStage();
  const { dx, dy, lag } = bolt;
  const style = useAnimatedStyle(() => {
    const pct = lagged(clock.value, lag);
    const out = track(pct, BOLT_OUT, EASE.glide);
    return {
      opacity: track(pct, BOLT_O, EASE.glide),
      transform: [{ translateX: dx * out * k }, { translateY: dy * out * k }],
    };
  });
  return (
    <Layer style={style}>
      <Materials use={['black']} />
      <Path d={bolt.hex} fill="url(#g-black)" />
      <Circle cx={bolt.x} cy={bolt.y} r={1.4} fill={STEEL_SOFT} />
    </Layer>
  );
}
