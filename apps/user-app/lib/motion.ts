import { useMemo } from 'react';
import { FadeInDown, Easing, useReducedMotion } from 'react-native-reanimated';

export const DURATION = { micro: 180, standard: 240, enter: 320 } as const;
export const PRESS_SPRING = { damping: 18, stiffness: 220, mass: 0.6 } as const;

// Re-export reanimated's synchronous hook so all existing import sites keep working unchanged.
export { useReducedMotion };

// Staggered entrance for list/grid items; undefined under reduce-motion. Delay capped for long lists.
export function useEntering(index = 0) {
  const reduced = useReducedMotion();
  return useMemo(
    () => (reduced ? undefined : FadeInDown
      .delay(Math.min(index, 12) * 40)
      .duration(DURATION.enter)
      .easing(Easing.out(Easing.cubic))),
    [reduced, index],
  );
}
