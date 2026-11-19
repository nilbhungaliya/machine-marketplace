import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

interface ArtSlotProps {
  /** The drawing's view box (width, height): its aspect ratio. */
  vb: readonly [number, number];
  /** The drawing's width when there is room for it, in points. */
  maxWidth: number;
  /** Below this width the drawing is left out (a phone with the keyboard open has no room for it). */
  minWidth?: number;
  /** Renders the drawing at the width that fits. */
  children: (width: number) => React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Room for an onboarding drawing above a form on a keyboard-aware screen. The slot asks for the drawing's full height
 * but is the only thing in the column that shrinks, so when the keyboard takes the bottom of a small phone the drawing
 * gets smaller (and at last goes) while the title, the field and the footer button stay on screen.
 */
export default function ArtSlot({ vb, maxWidth, minWidth = 80, children, style }: ArtSlotProps) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const s = useMemo(() => StyleSheet.create({
    slot: { height: (maxWidth * vb[1]) / vb[0], flexShrink: 1, minHeight: 0, alignItems: 'center', overflow: 'hidden' },
  }), [maxWidth, vb]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
  };

  const width = box ? Math.floor(Math.min(maxWidth, box.w, (box.h * vb[0]) / vb[1])) : 0;
  return (
    <View style={[s.slot, style]} onLayout={onLayout} pointerEvents="none">
      {box && width >= minWidth ? children(width) : null}
    </View>
  );
}
