import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import { ChevronLeft } from '@/lib/icons';
import IconButton from '@/components/IconButton';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  rightIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The app bar (Periwinkle v2 `.appbar`, spec §7.3): a raised round back button and a one-line, left-aligned title. */
export default function Header({ title, showBack = true, onBack, rightIcon, style }: HeaderProps) {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    container: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.background,
    },
    title: { flex: 1, ...type('appBar'), color: colors.text },
    right: { alignItems: 'center', justifyContent: 'center' },
  }), [colors, type]);

  const handleBack = () => {
    if (onBack) onBack();
    else navigation.goBack();
  };

  return (
    <View style={[s.container, style]}>
      {showBack ? (
        <IconButton
          icon={ChevronLeft}
          iconSize={22}
          onPress={handleBack}
          accessibilityLabel={t('common.back')}
          testID="Back-button"
        />
      ) : null}
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      {rightIcon ? <View style={s.right}>{rightIcon}</View> : null}
    </View>
  );
}
