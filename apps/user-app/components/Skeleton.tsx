import React, { useEffect } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

// One clock for every placeholder on screen, so they pulse together rather
// than each on its own beat.
const pulse = new Animated.Value(0);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;

function start() {
  users += 1;
  if (loop) return;
  loop = Animated.loop(Animated.sequence([
    Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
  ]));
  loop.start();
}

function stop() {
  users -= 1;
  if (users > 0 || !loop) return;
  loop.stop();
  loop = null;
}

/** A grey block in the shape of content that has not loaded yet. */
export default function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  useEffect(() => {
    start();
    return stop;
  }, []);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  return <Animated.View style={[{ backgroundColor: '#ebe9f0', borderRadius: 12 }, style, { opacity }]} />;
}
