import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Info, type LucideIcon } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

interface NoticeProps {
  text: string;
  title?: string;
  tone?: NoticeTone;
  icon?: LucideIcon;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A tinted callout (Periwinkle v2 `.callout`, spec §7.2): an icon, an optional bold title, a message and optional
 * actions below it. `info` is lavender with a hairline violet border; the status tones sit on their soft fill.
 */
export default function Notice({ text, title, tone = 'info', icon: Icon = Info, children, style }: NoticeProps) {
  const { colors } = useTheme();
  const type = useType();
  const tint = {
    info: { fg: colors.primaryInk, bg: colors.primaryWash, border: colors.primarySoft },
    success: { fg: colors.ok, bg: colors.okSoft, border: colors.okSoft },
    warning: { fg: colors.warn, bg: colors.warnSoft, border: colors.warnSoft },
    danger: { fg: colors.danger, bg: colors.dangerSoft, border: colors.dangerSoft },
  }[tone];
  const s = useMemo(() => StyleSheet.create({
    box: {
      flexDirection: 'row', gap: spacing.md, padding: 14, borderRadius: radius.lg,
      backgroundColor: tint.bg, borderWidth: 1, borderColor: tint.border,
    },
    body: { flex: 1, gap: spacing.xs },
    title: { ...type('bodyStrong'), fontFamily: fonts.bold, color: colors.text },
    text: { ...type('body'), color: colors.text },
  }), [colors, type, tint.bg, tint.border]);

  return (
    <View style={[s.box, style]}>
      <Icon size={20} color={tint.fg} />
      <View style={s.body}>
        {title ? <Text style={s.title}>{title}</Text> : null}
        <Text style={s.text}>{text}</Text>
        {children}
      </View>
    </View>
  );
}
