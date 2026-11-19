import React, { useEffect, useMemo } from 'react';
import { Animated, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import { useSheetAnimation } from '@/hooks/use-sheet-animation';
import AppToast from '@/components/AppToast';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Translated. */
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** The backdrop's accessibility label (it closes the sheet); "Cancel" when omitted. */
  closeLabel?: string;
  /** `testID` of the backdrop (it closes the sheet). */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The v2 `.sheet` frame for sheets with their own content (sign-in, location): a transparent Modal with the
 * `use-sheet-animation` entrance, scrim backdrop and hardware Back closing it, the handle, an optional title, and the
 * content scrolling above the keyboard. `ActionSheet` stays the one for a list of rows.
 */
export default function BottomSheet({
  visible, onClose, title, subtitle, children, closeLabel, testID, style,
}: BottomSheetProps) {
  const { t } = useTranslation();
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
    head: { paddingHorizontal: spacing.xl, marginBottom: spacing.md, gap: spacing.xs },
    title: { ...type('sheetTitle'), color: colors.text },
    subtitle: { ...type('body'), color: colors.textSecondary },
    body: { paddingHorizontal: spacing.lg, gap: spacing.md },
  }), [colors, type]);

  if (!rendered) return null;

  return (
    <Modal transparent visible={rendered} animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable
            style={s.fill}
            onPress={onClose}
            testID={testID ?? 'Sheet-backdrop'}
            accessibilityRole="button"
            accessibilityLabel={closeLabel ?? t('common.cancel')}
          />
        </Animated.View>
        <Animated.View style={[s.card, { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] }, style]}>
          <View style={s.handle} />
          {title || subtitle ? (
            <View style={s.head}>
              {title ? <Text style={s.title} accessibilityRole="header">{title}</Text> : null}
              {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            </View>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
      <AppToast inModal />
    </Modal>
  );
}
