import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, KeyboardAvoidingView, Keyboard, Pressable, ScrollView,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

interface ScreenWrapperProps {
  children: React.ReactNode;
  backgroundColor?: string;
  /** Push content up so the keyboard never covers a focused input. */
  keyboardAware?: boolean;
  /** Tap on empty space dismisses the keyboard (non-scroll screens). */
  dismissKeyboardOnTap?: boolean;
  /** Wrap children in a ScrollView (keyboard-persisting taps + drag-to-dismiss). */
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Offset for KeyboardAvoidingView (e.g. when a header sits above). */
  keyboardVerticalOffset?: number;
  /**
   * Safe-area edges to inset. Defaults to top+bottom so content isn't hidden
   * behind the Android system nav bar (edge-to-edge is on by default). Screens
   * inside a bottom-tab navigator can pass `['top']`: the floating tab bar is
   * absolutely positioned and insets nothing, so those screens instead pad
   * their own bottom via `useTabBarInset()`.
   */
  edges?: readonly Edge[];
}

export default function ScreenWrapper({
  children,
  backgroundColor,
  keyboardAware = false,
  dismissKeyboardOnTap = false,
  scroll = false,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  edges = ['top', 'bottom'],
}: ScreenWrapperProps) {
  const { colors } = useTheme();
  // The hook reads the insets straight from the provider, which is seeded with
  // initialWindowMetrics. SafeAreaView measures itself natively instead, and on
  // Android it reports zero for a frame when it remounts mid-transition — which
  // dropped the header under the status bar on repeated navigation.
  const insets = useSafeAreaInsets();

  const scrollRef = useRef<ScrollView>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // The keyboard shrinks the scroll area from the bottom, which is exactly where
  // these screens keep their submit button — it drops below the fold with nothing
  // on screen hinting it is still there. Ride the scroll down to it.
  const revealBottom = useCallback(() => {
    if (keyboardOpen) scrollRef.current?.scrollToEnd({ animated: true });
  }, [keyboardOpen]);

  // Fires on whichever lands second: the keyboard flag or the shrunk layout.
  // Android reports the keyboard first, iOS resizes first.
  useEffect(() => { revealBottom(); }, [revealBottom]);

  let content: React.ReactNode = children;

  if (scroll) {
    // Scrollable forms: taps on inputs/buttons still work ('handled'); tapping
    // empty space or dragging dismisses the keyboard.
    content = (
      <ScrollView
        ref={scrollRef}
        onLayout={revealBottom}
        style={styles.flex}
        contentContainerStyle={[styles.grow, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  } else if (dismissKeyboardOnTap) {
    // Non-scroll screens: a full-bleed Pressable closes the keyboard on an
    // outside tap. Taps on inputs/buttons are consumed by them, not this layer.
    content = (
      <Pressable style={styles.flex} onPress={Keyboard.dismiss} accessible={false}>
        {children}
      </Pressable>
    );
  }

  if (keyboardAware) {
    content = (
      <KeyboardAvoidingView
        style={styles.flex}
        // 'padding' on both platforms: it's JS-driven (keyboard events), so it
        // works under Android edge-to-edge where windowSoftInputMode=resize is
        // ineffective — fixing inputs that were hidden by the keyboard on Android.
        behavior="padding"
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {content}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: backgroundColor ?? colors.background,
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: edges.includes('left') ? insets.left : 0,
          paddingRight: edges.includes('right') ? insets.right : 0,
        },
      ]}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
});
