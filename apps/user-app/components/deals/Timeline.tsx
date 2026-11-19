import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useType } from '@/hooks/use-type';
import type { TimelineRow } from '@/lib/deal-display';
import { spacing, useTheme } from '@/lib/theme';

interface TimelineProps {
  rows: TimelineRow[];
  style?: StyleProp<ViewStyle>;
}

/** The Deal record's timeline (mockup `.timeline`): a dot per step, green when done, the time on the right. */
export default function Timeline({ rows, style }: TimelineProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    wrap: { gap: 0 },
    row: { flexDirection: 'row', gap: spacing.md, minHeight: 40 },
    rail: { alignItems: 'center', width: 14 },
    dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 4 },
    line: { flex: 1, width: 2, backgroundColor: colors.divider, marginVertical: 2 },
    body: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingBottom: spacing.md },
    label: { ...type('bodyStrong'), color: colors.text, flexShrink: 1 },
    labelTodo: { ...type('body'), color: colors.textMuted, flexShrink: 1 },
    when: { ...type('caption'), color: colors.textMuted, textAlign: 'right' },
  }), [colors, type]);

  return (
    <View style={[s.wrap, style]}>
      {rows.map((r, i) => {
        const values = {
          ...r.values,
          actor: typeof r.values.actor === 'string' ? t(`deals.actor.${r.values.actor}`) : '',
          reason: typeof r.values.reason === 'string' ? t(`deals.cancelReason.${r.values.reason}`, { defaultValue: '' }) : '',
          outcome: typeof r.values.outcome === 'string' ? t(`deals.outcome.${r.values.outcome}`, { defaultValue: '' }) : '',
          category: typeof r.values.category === 'string' ? t(`deals.category.${r.values.category}`, { defaultValue: '' }) : '',
        };
        return (
          <View key={r.key} style={s.row}>
            <View style={s.rail}>
              <View style={[s.dot, r.done ? { backgroundColor: colors.ok, borderColor: colors.ok } : { borderColor: colors.border }]} />
              {i < rows.length - 1 ? <View style={s.line} /> : null}
            </View>
            <View style={s.body}>
              <Text style={r.done ? s.label : s.labelTodo}>{t(r.labelKey, values)}</Text>
              {r.when ? <Text style={s.when}>{r.when}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
