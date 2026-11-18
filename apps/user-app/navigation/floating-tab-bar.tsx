import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@/lib/tab-bar';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * The floating pill tab bar (Periwinkle v2 `.tabbar`, spec §7.5). Absolutely placed, so screens draw full height
 * under it and pad their content with `useTabBarInset()`. Icon-only (Ruling R9): each tab keeps its translated name as
 * its accessibility label. Post is always the violet circle. Hidden while the keyboard is open.
 */
export default function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // The stock `tabBarHideOnKeyboard` only applies to React Navigation's own bar. iOS sends the "will" events, so the
  // bar goes with the keyboard rather than after it; Android only sends the "did" ones.
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const s = useMemo(() => StyleSheet.create({
    bar: {
      position: 'absolute', left: spacing.lg, right: spacing.lg, height: TAB_BAR_HEIGHT,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: spacing.sm,
      borderRadius: radius.full, backgroundColor: colors.surface, ...shadows.float,
    },
    tab: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.primaryWash },
    post: { width: 52, height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  }), [colors, shadows]);

  if (keyboardOpen) return null;

  return (
    <View style={[s.bar, { bottom: TAB_BAR_GAP + insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const isPost = route.name === 'Post';
        const color = isPost ? colors.onPrimary : focused ? colors.primaryInk : colors.textMuted;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

        return (
          <Pressable
            key={route.key}
            style={[isPost ? s.post : s.tab, !isPost && focused && s.tabOn]}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarButtonTestID}
            hitSlop={4}
          >
            {options.tabBarIcon?.({ focused, color, size: isPost ? 24 : 22 })}
          </Pressable>
        );
      })}
    </View>
  );
}
