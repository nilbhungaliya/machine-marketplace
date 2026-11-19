import React, { useEffect, useRef } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { ArtStage, Layer, useStage } from '@/components/art/stage';
import Materials, { GLINT, SHADOW_INK, STEEL_DARK, STEEL_EDGE, STEEL_MID, STEEL_SOFT } from '@/components/art/materials';
import { useLoop } from '@/hooks/use-loop';
import { useReducedMotion } from '@/lib/motion';
import { EASE, cubicBezier, easeOut, linear, steps, track } from '@/lib/motion-track';
import { useTheme } from '@/lib/theme';

// 03 Code (docs/mockups/onboarding-motion.html, `.flange`): a flange with six bolts, one per digit of the code. Each
// digit typed tightens the next bolt in four ratchet clicks, paints its yellow torque stripe and flashes its click
// marks; a dashed socket ring waits on the next bolt. Verified: the flange turns 60°, the seal fills green and a tick
// draws. Backspace backs the last bolt out again.

export const FLANGE_VB = [260, 156] as const;
const CENTRE = [130, 78] as const;
const BOLT_COUNT = 6;

/** Bolt centres: radius 44, every 60°, the first at the top (as the mockup's script places them). */
const BOLTS = Array.from({ length: BOLT_COUNT }, (_, i) => {
  const deg = i * 60;
  const a = ((deg - 90) * Math.PI) / 180;
  return { deg, x: CENTRE[0] + 44 * Math.cos(a), y: CENTRE[1] + 44 * Math.sin(a) };
});

/** The bolt head's hexagon (circumradius 8.2, flats top and bottom), in a bolt's own 44 × 44 box centred on 22, 22. */
const HEX = Array.from({ length: 6 }, (_, j) => {
  const b = (j * Math.PI) / 3 + Math.PI / 6;
  return `${j ? 'L' : 'M'}${(22 + 8.2 * Math.cos(b)).toFixed(2)} ${(22 + 8.2 * Math.sin(b)).toFixed(2)}`;
}).join('') + 'Z';

const BOX = 44;
const BOLT_VB = [BOX, BOX] as const;
const HEAD_ORIGIN = [22, 22] as const;
/** The torque stripe runs from the outer end (y 8) inwards; it paints from there. */
const STRIPE_ORIGIN = [22, 6.7] as const;
const CLICK_ORIGIN = [22, 7] as const;

/** CSS `ease`, the mockup's default transition. */
const EASE_CSS = cubicBezier(0.25, 0.1, 0.25, 1);
const HEAD_MS = 520; // steps(4)
const CLICKS = steps(4);
const SHADOW_MS = 500;
const STRIPE_MS = 250;
const STRIPE_DELAY = 520;
const CLICK_MS = 450;
const CLICK_DELAY = 400;
const CLICK_OPACITY = [[0, 0], [30, 1], [100, 0]] as const;
const SOCKET_MS = 420;
const SOCKET_FADE_MS = 300;
/** The dashed ring creeps round: the mockup's dash offset moves 14 of the ring's 88 units (2π × 14) in 3 s. */
const SOCKET_SPIN_MS = Math.round((3000 * (2 * Math.PI * 14)) / 14);
/** The socket ring is drawn on the first bolt and moved from there. */
const SOCKET_HOME = [BOLTS[0].x, BOLTS[0].y] as const;
const TURN_MS = 1150;
const SEAL_MS = 450;
const TICK_MS = 400;
const TICK_DELAY = 350;

interface BoltFlangeProps {
  /** Digits of the code entered, 0–6: the bolts tightened so far. */
  tight: number;
  /** The code was accepted: the flange turns and the seal goes green. */
  verified: boolean;
  /** Drawn width in points. */
  width: number;
}

/** Decorative: ArtStage hides it from screen readers. Under reduce motion every part jumps to its state. */
export default function BoltFlange({ tight, verified, width }: BoltFlangeProps) {
  const n = Math.max(0, Math.min(BOLT_COUNT, Math.round(tight)));
  return (
    <ArtStage vb={FLANGE_VB} width={width}>
      <Layer>
        <Materials use={['shadow']} />
        <Ellipse cx={130} cy={148} rx={70} ry={6} fill="url(#g-sh)" />
      </Layer>
      <Turn verified={verified}>
        <Layer>
          <Materials use={['steel']} />
          <Circle cx={130} cy={78} r={64} fill="url(#g-steel)" stroke={STEEL_EDGE} strokeWidth={0.8} />
          <Circle cx={130} cy={78} r={56} fill="none" stroke={GLINT} strokeOpacity={0.35} strokeWidth={1} />
          <Circle cx={130} cy={78} r={29} fill={STEEL_SOFT} />
          <Circle cx={130} cy={78} r={27} fill="url(#g-steel)" />
          <Path d="M80 50A60 60 0 0 1 118 19" stroke={GLINT} strokeOpacity={0.75} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </Layer>
        {BOLTS.map((b, i) => <Bolt key={b.deg} index={i} tight={i < n} />)}
      </Turn>
      <Seal verified={verified} />
      <Socket at={n} gone={n >= BOLT_COUNT || verified} />
    </ArtStage>
  );
}

/** The flange group: turns 60° about the centre when the code is verified. */
function Turn({ verified, children }: { verified: boolean; children: React.ReactNode }) {
  const { k } = useStage();
  const reduced = useReducedMotion();
  const turn = useSharedValue(verified ? 60 : 0);
  useEffect(() => {
    const to = verified ? 60 : 0;
    turn.value = reduced ? to : withTiming(to, { duration: TURN_MS, easing: EASE.glide });
  }, [verified, reduced, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const base: ViewStyle = { ...StyleSheet.absoluteFillObject, transformOrigin: [CENTRE[0] * k, CENTRE[1] * k, 0] };
  return <Animated.View style={[base, style]}>{children}</Animated.View>;
}

/** One bolt, drawn in its own 44 × 44 box, turned so its torque stripe points away from the centre. */
function Bolt({ index, tight }: { index: number; tight: boolean }) {
  const { k } = useStage();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const { deg, x, y } = BOLTS[index];

  const head = useSharedValue(tight ? 1 : 0);
  const shadow = useSharedValue(tight ? 1 : 0);
  const stripe = useSharedValue(tight ? 1 : 0);
  const click = useSharedValue(0);
  const first = useRef(true);

  useEffect(() => {
    const to = tight ? 1 : 0;
    if (first.current || reduced) {
      first.current = false;
      cancelAnimation(click);
      head.value = to;
      shadow.value = to;
      stripe.value = to;
      click.value = 0;
      return;
    }
    head.value = withTiming(to, { duration: HEAD_MS, easing: CLICKS });
    shadow.value = withTiming(to, { duration: SHADOW_MS, easing: EASE_CSS });
    stripe.value = tight
      ? withDelay(STRIPE_DELAY, withTiming(1, { duration: STRIPE_MS, easing: easeOut }))
      : withTiming(0, { duration: STRIPE_MS, easing: easeOut });
    cancelAnimation(click);
    click.value = 0;
    if (tight) click.value = withDelay(CLICK_DELAY, withTiming(1, { duration: CLICK_MS, easing: linear }));
  }, [tight, reduced, head, shadow, stripe, click]);

  // Loose: turned back 120° and standing proud (scale 1.24); tight: flush.
  const headStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-120 * (1 - head.value)}deg` }, { scale: 1.24 - 0.24 * head.value }],
  }));
  // The shadow tucks under the washer as the bolt seats.
  const shadowStyle = useAnimatedStyle(() => {
    const p = shadow.value;
    return {
      opacity: 0.38 - 0.13 * p,
      transform: [{ translateX: (3 - 2.2 * p) * k }, { translateY: (4 - 3 * p) * k }],
    };
  });
  const stripeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: stripe.value }] }));
  const clickStyle = useAnimatedStyle(() => {
    const pct = click.value * 100;
    return {
      opacity: track(pct, CLICK_OPACITY, easeOut),
      transform: [{ scale: 0.8 + 0.55 * easeOut(click.value) }],
    };
  });

  const place: ViewStyle = {
    position: 'absolute', left: (x - BOX / 2) * k, top: (y - BOX / 2) * k, transform: [{ rotate: `${deg}deg` }],
  };
  return (
    <ArtStage vb={BOLT_VB} width={BOX * k} style={place}>
      <Layer style={shadowStyle}>
        <Circle cx={22} cy={22} r={9} fill={SHADOW_INK} />
      </Layer>
      <Layer>
        <Materials use={['steel']} />
        <Circle cx={22} cy={22} r={10.5} fill={STEEL_MID} />
        <Circle cx={22} cy={22} r={9.6} fill="url(#g-steel)" />
      </Layer>
      <Layer style={headStyle} origin={HEAD_ORIGIN}>
        <Materials use={['black']} />
        <Path d={HEX} fill="url(#g-black)" />
        <Circle cx={22} cy={22} r={3.4} fill={STEEL_DARK} />
        <Path d="M16 19.5 L28 19.5" stroke={GLINT} strokeOpacity={0.25} />
      </Layer>
      <Layer style={stripeStyle} origin={STRIPE_ORIGIN}>
        <Path d="M22 8 L22 24" stroke={colors.sun} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </Layer>
      <Layer style={clickStyle} origin={CLICK_ORIGIN}>
        <Path
          d="M9 13 l-4 -3 M35 13 l4 -3 M22 5 l0 -4"
          stroke={colors.primary}
          strokeWidth={1.6}
          strokeLinecap="round"
          fill="none"
        />
      </Layer>
    </ArtStage>
  );
}

/** The seal in the middle: fills green and a tick draws (left to right) once the code is verified. */
function Seal({ verified }: { verified: boolean }) {
  const { k } = useStage();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const fill = useSharedValue(verified ? 1 : 0);
  const tick = useSharedValue(verified ? 1 : 0);

  useEffect(() => {
    const to = verified ? 1 : 0;
    if (reduced) {
      fill.value = to;
      tick.value = to;
      return;
    }
    fill.value = withTiming(to, { duration: SEAL_MS, easing: EASE_CSS });
    tick.value = withDelay(TICK_DELAY, withTiming(to, { duration: TICK_MS, easing: EASE.glide }));
  }, [verified, reduced, fill, tick]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  // The tick runs left to right, so a window sliding open over it draws it.
  const W = 24;
  const clip = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - tick.value) * W * k }] }));
  const counter = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - tick.value) * W * k }] }));
  const box: ViewStyle = { position: 'absolute', left: 118 * k, top: 68 * k, width: W * k, height: 20 * k, overflow: 'hidden' };

  return (
    <>
      <Layer>
        <Circle cx={130} cy={78} r={20} fill={colors.photo} stroke={STEEL_EDGE} strokeWidth={0.8} />
      </Layer>
      <Layer style={fillStyle}>
        <Circle cx={130} cy={78} r={20} fill={colors.ok} stroke={STEEL_EDGE} strokeWidth={0.8} />
      </Layer>
      <Animated.View style={[box, clip]}>
        <Animated.View style={[StyleSheet.absoluteFill, counter]}>
          <Svg width="100%" height="100%" viewBox={`118 68 ${W} 20`}>
            <Path
              d="M121 78.5l6 6 12-12.5"
              fill="none"
              stroke={GLINT}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </>
  );
}

/** The dashed socket ring: glides to the next bolt to tighten and creeps round while it waits; gone at six. */
function Socket({ at, gone }: { at: number; gone: boolean }) {
  const { k } = useStage();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const spin = useLoop(SOCKET_SPIN_MS, 0);
  const home = { x: SOCKET_HOME[0], y: SOCKET_HOME[1] };
  const target = BOLTS[Math.min(at, BOLT_COUNT - 1)];
  const dx = useSharedValue(target.x - home.x);
  const dy = useSharedValue(target.y - home.y);
  const shown = useSharedValue(gone ? 0 : 1);

  useEffect(() => {
    // At six the ring stays on the last bolt and fades, as in the mockup.
    if (!gone) {
      const tx = target.x - home.x;
      const ty = target.y - home.y;
      dx.value = reduced ? tx : withTiming(tx, { duration: SOCKET_MS, easing: EASE.glide });
      dy.value = reduced ? ty : withTiming(ty, { duration: SOCKET_MS, easing: EASE.glide });
    }
    const to = gone ? 0 : 1;
    shown.value = reduced ? to : withTiming(to, { duration: SOCKET_FADE_MS, easing: EASE_CSS });
  }, [gone, target.x, target.y, home.x, home.y, reduced, dx, dy, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: dx.value * k }, { translateY: dy.value * k }, { rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <Layer style={style} origin={SOCKET_HOME}>
      <Circle cx={home.x} cy={home.y} r={14} fill="none" stroke={colors.primary} strokeWidth={2} strokeDasharray="4 3" />
    </Layer>
  );
}
