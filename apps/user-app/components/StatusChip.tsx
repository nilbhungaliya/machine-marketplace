import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from '@/lib/icons';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'new' | 'sun';

/** Fill and ink per tone (spec §7.2): status colours on their soft fill; `sun` is the yellow badge. */
export function statusChipColors(tone: StatusTone, c: ThemeColors): { bg: string; fg: string } {
  switch (tone) {
    case 'ok': return { bg: c.okSoft, fg: c.ok };
    case 'warn': return { bg: c.warnSoft, fg: c.warn };
    case 'danger': return { bg: c.dangerSoft, fg: c.danger };
    case 'info': return { bg: c.primaryWash, fg: c.primaryInk };
    case 'neutral': return { bg: c.divider, fg: c.textSecondary };
    case 'new': return { bg: c.primary, fg: c.onPrimary };
    case 'sun': return { bg: c.sun, fg: c.onSun };
  }
}

interface StatusChipProps {
  /** Already translated. */
  label: string;
  tone: StatusTone;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}

/** A small status pill (Periwinkle v2 `.badge` / `.st` / `.sun`, spec §7.2). Not pressable. */
export default function StatusChip({ label, tone, icon: Icon, style }: StatusChipProps) {
  const { colors } = useTheme();
  const type = useType();
  const { bg, fg } = statusChipColors(tone, colors);
  const s = useMemo(() => StyleSheet.create({
    chip: {
      flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs,
      paddingHorizontal: 10, paddingVertical: spacing.xs, borderRadius: radius.full,
    },
    label: { ...type('badge') },
  }), [type]);
  return (
    <View style={[s.chip, { backgroundColor: bg }, style]}>
      {Icon ? <Icon size={12} color={fg} strokeWidth={2.3} /> : null}
      <Text style={[s.label, { color: fg }]}>{label}</Text>
    </View>
  );
}
