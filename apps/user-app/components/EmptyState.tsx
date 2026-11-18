import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Button from '@/components/Button';
import { spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
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

/** Nothing here yet (spec §7.2): a lavender icon well, a centred title and subtitle, an optional call to action. */
export default function EmptyState({ icon: Icon, title, subtitle, ctaTitle, onCtaPress, ctaPhLabel, style }: EmptyStateProps) {
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxxl },
    iconWrap: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
    },
    title: { ...type('section'), color: colors.text, textAlign: 'center' },
    subtitle: { ...type('body'), color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
    cta: { marginTop: spacing.xxl, width: 'auto', minWidth: 200 },
  }), [colors, type]);

  return (
    <View style={[s.container, style]}>
      <View style={s.iconWrap}>
        <Icon size={36} color={colors.primaryInk} />
      </View>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
      {ctaTitle && onCtaPress ? (
        <Button title={ctaTitle} phLabel={ctaPhLabel} onPress={onCtaPress} size="md" style={s.cta} />
      ) : null}
    </View>
  );
}
