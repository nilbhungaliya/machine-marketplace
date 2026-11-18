import React, { useEffect, useMemo } from 'react';
import { Animated, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import { useSheetAnimation } from '@/hooks/use-sheet-animation';
import ListRow from '@/components/ListRow';
import AppToast from '@/components/AppToast';

export interface ActionSheetItem {
  /** Returned to `onSelect` (an action name such as `pause`, a report reason). */
  key: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  /** Remove, Mark sold: drawn in `danger` (the caller still confirms). */
  destructive?: boolean;
  disabled?: boolean;
  /** A single-choice list (report reasons): the chosen row. */
  selected?: boolean;
  testID: string;
}

interface ActionSheetProps {
  visible: boolean;
  /** Translated; the listing's title on the manage sheet. */
  title?: string;
  subtitle?: string;
  items: ActionSheetItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
  /** Content under the rows (report details input, a submit button). */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A bottom sheet with a list of rows (v2 `.sheet` + `.actions`, F2 spec §15.2): the manage sheet, report reasons.
 * Animated with `use-sheet-animation` in a transparent Modal; the backdrop and hardware Back close it. Labels come
 * from the caller (no copy inside).
 */
export default function ActionSheet({ visible, title, subtitle, items, onSelect, onClose, children, style }: ActionSheetProps) {
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();
  const { rendered, backdropOpacity, translateY } = useSheetAnimation(visible);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  const s = useMemo(() => StyleSheet.create({
    wrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
    fill: { flex: 1 },
    card: {
      backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
      paddingTop: 10, maxHeight: '88%',
    },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
    head: { paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
    title: { ...type('sheetTitle'), color: colors.text },
    subtitle: { ...type('caption'), color: colors.textSecondary, marginTop: 2 },
    list: {
      marginHorizontal: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden',
    },
    extra: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  }), [colors, type]);

  if (!rendered) return null;

  return (
    <Modal transparent visible={rendered} animationType="none" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={s.fill} onPress={onClose} testID="Action-sheet-backdrop" accessibilityRole="button" />
        </Animated.View>
        <Animated.View style={[s.card, { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] }, style]}>
          <View style={s.handle} />
          {title || subtitle ? (
            <View style={s.head}>
              {title ? <Text style={s.title} numberOfLines={2}>{title}</Text> : null}
              {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            </View>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {items.length > 0 ? (
              <View style={s.list}>
                {items.map((item, i) => (
                  <ListRow
                    key={item.key}
                    label={item.label}
                    hint={item.hint}
                    icon={item.icon}
                    danger={item.destructive}
                    disabled={item.disabled}
                    selected={item.selected}
                    last={i === items.length - 1}
                    onPress={() => onSelect(item.key)}
                    testID={item.testID}
                    accessibilityRole={item.selected !== undefined ? 'radio' : 'button'}
                    accessibilityState={item.selected !== undefined ? { selected: item.selected } : undefined}
                  />
                ))}
              </View>
            ) : null}
            {children ? <View style={s.extra}>{children}</View> : null}
          </ScrollView>
        </Animated.View>
      </View>
      <AppToast inModal />
    </Modal>
  );
}
