import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RentalBookingStatus, RentalBookingView } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { formatDayMonth, formatTime } from '@/lib/format-date';
import { spacing, useTheme } from '@/lib/theme';

interface BookingTimelineProps {
  view: Pick<RentalBookingView, 'timeline' | 'status' | 'side'>;
  style?: StyleProp<ViewStyle>;
}

/** The steps still ahead of a booking in this status (mockup "Booking updates": greyed until they happen). */
const NEXT: Partial<Record<RentalBookingStatus, string[]>> = {
  requested: ['confirmed', 'on_site', 'returned', 'reviews'],
  countered: ['confirmed', 'on_site', 'returned', 'reviews'],
  confirmed: ['on_site', 'returned', 'reviews'],
  on_rent: ['returned', 'reviews'],
  returned: ['completed', 'reviews'],
  completed: ['reviews'],
};

/**
 * The Booking record's timeline (mockup rental · "Booking updates" `.timeline`): what happened, violet dots with the
 * IST time, then the steps still ahead in grey. Events carry codes and the acting side, never text a user typed;
 * "you" when the reader's side acted. Notes edits are left out (they show on the notes card).
 */
export default function BookingTimeline({ view, style }: BookingTimelineProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.md, minHeight: 40 },
    rail: { alignItems: 'center', width: 14 },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 3 },
    dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotTodo: { backgroundColor: colors.surface, borderColor: colors.border },
    line: { flex: 1, width: 2, marginVertical: 2 },
    body: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingBottom: spacing.md },
    label: { ...type('bodyStrong'), color: colors.text, flexShrink: 1 },
    labelTodo: { ...type('body'), color: colors.textMuted, flexShrink: 1 },
    when: { ...type('caption'), color: colors.textMuted, textAlign: 'right' },
  }), [colors, type]);

  const actor = (side: string) => (side === view.side ? t('rentals.actor.you') : t(`rentals.actor.${side}`));
  const done = view.timeline
    .filter((e) => e.code !== 'notes_changed')
    .map((e, i) => {
      const ms = Date.parse(e.at);
      return {
        key: `e${i}`,
        label: t(`rentals.timeline.${e.code}`, { actor: actor(e.actorSide) }),
        when: Number.isNaN(ms) ? '' : `${formatDayMonth(ms)}, ${formatTime(ms)}`,
        done: true,
      };
    });
  const todo = (NEXT[view.status] ?? []).map((k) => ({ key: `n-${k}`, label: t(`rentals.timeline.next.${k}`), when: '', done: false }));
  const rows = [...done, ...todo];

  return (
    <View style={style}>
      {rows.map((r, i) => {
        const nextDone = rows[i + 1]?.done ?? false;
        return (
          <View key={r.key} style={s.row}>
            <View style={s.rail}>
              <View style={[s.dot, r.done ? s.dotDone : s.dotTodo]} />
              {i < rows.length - 1 ? (
                <View style={[s.line, { backgroundColor: r.done && nextDone ? colors.primary : colors.divider }]} />
              ) : null}
            </View>
            <View style={s.body}>
              <Text style={r.done ? s.label : s.labelTodo}>{r.label}</Text>
              {r.when ? <Text style={s.when}>{r.when}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
