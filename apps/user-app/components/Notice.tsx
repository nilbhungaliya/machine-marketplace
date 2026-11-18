import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Info, type LucideIcon } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

interface NoticeProps {
  text: string;
  title?: string;
  tone?: NoticeTone;
  icon?: LucideIcon;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A tinted callout: an icon, an optional bold title, a message and optional actions below it. */
export default function Notice({ text, title, tone = 'info', icon: Icon = Info, children, style }: NoticeProps) {
  const { colors } = useTheme();
  const tint = {
    info: { fg: colors.primary, bg: colors.primaryMuted },
    success: { fg: colors.green, bg: colors.greenMuted },
    warning: { fg: colors.orange, bg: colors.orangeMuted },
    danger: { fg: colors.red, bg: colors.redMuted },
  }[tone];
  const s = useMemo(() => StyleSheet.create({
    box: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: tint.bg },
    body: { flex: 1, gap: spacing.xs },
    title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
    text: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.text },
  }), [colors, tint.bg]);

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
