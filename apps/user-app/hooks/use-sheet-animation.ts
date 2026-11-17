import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing } from 'react-native';
import { useReducedMotion, DURATION } from '@/lib/motion';

export type SheetAnimation = {
  rendered: boolean;
  backdropOpacity: Animated.AnimatedInterpolation<number>;
  translateY: Animated.AnimatedInterpolation<number>;
};

/**
 * Entrance and exit for a bottom sheet drawn in a transparent Modal.
 *
 * Modal's own animationType="slide" moves the whole native window, so the dim
 * backdrop rises and falls with the card instead of fading in place. Pass
 * animationType="none" and drive the two separately with these values.
 */
export function useSheetAnimation(visible: boolean): SheetAnimation {
  const reduced = useReducedMotion();
  const screenH = Dimensions.get('window').height;
  // Kept mounted through the closing animation, which `visible` alone would cut off.
  const [rendered, setRendered] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.timing(anim, {
        // Matches the pacing of Modal's own slide, which this replaces: without
        // the easing, the default ease-in-out makes the sheet snap into place.
        toValue: 1, duration: reduced ? 0 : DURATION.enter,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    } else if (rendered) {
      Animated.timing(anim, {
        toValue: 0, duration: reduced ? 0 : DURATION.standard,
        easing: Easing.in(Easing.cubic), useNativeDriver: true,
      // finished is false if a re-open interrupts the exit, so we won't wrongly unmount.
      }).start(({ finished }) => { if (finished) setRendered(false); });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoised: interpolate() builds a native animated node, and a fresh one on
  // every render would be re-attached each time.
  const backdropOpacity = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }), [anim],
  );
  const translateY = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [screenH, 0] }), [anim, screenH],
  );

  return { rendered, backdropOpacity, translateY };
}
