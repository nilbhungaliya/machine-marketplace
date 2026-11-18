import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Button from '@/components/Button';
import { fonts, useTheme } from '@/lib/theme';
import type { LucideIcon } from '@/lib/icons';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  ctaTitle?: string;
  onCtaPress?: () => void;
  /** English label for the CTA (stays English when ctaTitle is translated). */
  ctaPhLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export default function EmptyState({ icon: Icon, title, subtitle, ctaTitle, onCtaPress, ctaPhLabel, style }: EmptyStateProps) {
  const { colors } = useTheme();

  const s = useMemo(() => StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    iconWrap: {
      width: 80, height: 80, borderRadius: 40,
      backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, textAlign: 'center' },
    subtitle: {
      fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary,
      marginTop: 8, textAlign: 'center', lineHeight: 20,
    },
    cta: { marginTop: 28, width: 220 },
  }), [colors]);

  return (
    <View style={[s.container, style]}>
      <View style={s.iconWrap}>
        <Icon size={34} color={colors.primary} />
      </View>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
      {ctaTitle && onCtaPress && <Button title={ctaTitle} phLabel={ctaPhLabel} onPress={onCtaPress} style={s.cta} />}
    </View>
  );
}
