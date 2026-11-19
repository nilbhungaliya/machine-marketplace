import { useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  Easing, cancelAnimation, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/motion';

/**
 * A looping 0–1 clock for an onboarding drawing (mockup `animation: … 10s infinite`), read as a percentage by
 * `track()`. It runs only while the screen is focused, starts from 0 each time the screen comes back, and under
 * reduce motion (or while the screen is hidden) it holds `rest`: the drawing's finished frame.
 */
export function useLoop(durationMs: number, rest: number): SharedValue<number> {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const t = useSharedValue(reduced ? rest : 0);

  useEffect(() => {
    if (reduced || !focused) {
      cancelAnimation(t);
      t.value = rest;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [reduced, focused, durationMs, rest, t]);

  return t;
}

/**
 * A one-shot 0–1 clock: runs once from 0 to 1 over `durationMs` after `delayMs`, when the screen mounts. Linear: the
 * reader applies the easing. Under reduce motion it is 1 from the start.
 */
export function useOnce(durationMs: number, delayMs = 0): SharedValue<number> {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 1;
      return;
    }
    p.value = 0;
    p.value = withDelay(delayMs, withTiming(1, { duration: durationMs, easing: Easing.linear }));
    return () => cancelAnimation(p);
  }, [reduced, durationMs, delayMs, p]);

  return p;
}
