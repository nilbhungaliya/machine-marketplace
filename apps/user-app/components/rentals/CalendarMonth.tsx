import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RentalCalendarDay } from '@mpm/shared-types';
import IconButton from '@/components/IconButton';
import { useType } from '@/hooks/use-type';
import { formatMonthYear, monthShortNames, weekdayShortNames } from '@/lib/format-date';
import { ChevronLeft, ChevronRight } from '@/lib/icons';
import { monthGrid, type CalendarCell } from '@/lib/rental-calendar';
import { radius, spacing, useTheme } from '@/lib/theme';

interface CalendarMonthProps {
  year: number;
  /** 1–12. */
  month: number;
  days: readonly RentalCalendarDay[];
  /** Machines on the listing (the rack under each day has this many slots, up to 6). */
  quantity: number;
  /** IST today (`YYYY-MM-DD`). */
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Up to this many machines get one slot each in a day's rack; more share a filled bar. */
const MAX_SLOTS = 6;
const SWIPE = 48;

/**
 * The owner calendar's month (§7.3): weeks from Monday; under each day a small rack, one slot per machine, filled for
 * each one out (amber when some are out, red when none is free). Swipe or the arrows change month; a tap picks the day.
 */
export default function CalendarMonth({
  year, month, days, quantity, today, selected, onSelect, onPrev, onNext, style,
}: CalendarMonthProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const grid = useMemo(() => monthGrid(year, month, days), [year, month, days]);

  // Latest handlers for the pan responder, which is made once.
  const nav = useRef({ onPrev, onNext });
  nav.current = { onPrev, onNext };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_e, g) => {
      if (g.dx <= -SWIPE) nav.current.onNext();
      else if (g.dx >= SWIPE) nav.current.onPrev();
    },
  })).current;

  const s = useMemo(() => StyleSheet.create({
    wrap: { gap: spacing.sm },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    month: { ...type('section'), color: colors.text, flex: 1, textAlign: 'center' },
    week: { flexDirection: 'row' },
    weekday: { ...type('caption'), color: colors.textMuted, flex: 1, textAlign: 'center' },
    row: { flexDirection: 'row' },
    cell: {
      flex: 1, aspectRatio: 0.82, margin: 2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'space-between',
      paddingTop: spacing.sm, paddingBottom: spacing.sm, borderWidth: 1.5, borderColor: 'transparent',
    },
    cellPartial: { backgroundColor: colors.warnSoft },
    cellFull: { backgroundColor: colors.dangerSoft },
    cellSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    num: { ...type('bodyStrong'), color: colors.text },
    numOut: { color: colors.textMuted },
    numPast: { color: colors.textMuted },
    numToday: { color: colors.primaryInk },
    todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primaryInk, marginTop: 1 },
    rack: { flexDirection: 'row', gap: 2, paddingHorizontal: 4, width: '100%', justifyContent: 'center' },
    slot: { flex: 1, maxWidth: 6, height: 6, borderRadius: 1.5, backgroundColor: colors.hairline },
    slotOut: { backgroundColor: colors.warn },
    slotFull: { backgroundColor: colors.danger },
    bar: { height: 6, width: '80%', borderRadius: 3, backgroundColor: colors.hairline, overflow: 'hidden' },
  }), [colors, type]);

  // Monday-first weekday names (the shared names start on Sunday).
  const names = weekdayShortNames();
  const weekdays = [...names.slice(1), names[0]!];
  const monthTitle = formatMonthYear(Date.UTC(year, month - 1, 15));
  const months = monthShortNames();

  const rack = (c: CalendarCell) => {
    if (c.state === 'none' || quantity <= 0) return <View style={s.rack} />;
    const tone = c.state === 'full' ? s.slotFull : s.slotOut;
    if (quantity <= MAX_SLOTS) {
      return (
        <View style={s.rack}>
          {Array.from({ length: quantity }, (_, i) => (
            <View key={i} style={[s.slot, i < c.out ? tone : null]} />
          ))}
        </View>
      );
    }
    const pct = `${Math.min(100, Math.round((c.out / quantity) * 100))}%` as const;
    return (
      <View style={s.bar}>
        <View style={[{ width: pct, height: '100%' }, tone]} />
      </View>
    );
  };

  return (
    <View style={[s.wrap, style]}>
      <View style={s.head}>
        <IconButton icon={ChevronLeft} onPress={onPrev} accessibilityLabel={t('rentalsOwner.calendar.prev')} testID="Calendar-prev" variant="outline" />
        <Text style={s.month} accessibilityRole="header">{monthTitle}</Text>
        <IconButton icon={ChevronRight} onPress={onNext} accessibilityLabel={t('rentalsOwner.calendar.next')} testID="Calendar-next" variant="outline" />
      </View>
      <View style={s.week}>
        {weekdays.map((d) => <Text key={d} style={s.weekday}>{d}</Text>)}
      </View>
      <View {...pan.panHandlers}>
        {grid.map((row) => (
          <View key={row[0]!.date} style={s.row}>
            {row.map((c) => {
              const dayNum = Number(c.date.slice(8));
              const isToday = c.date === today;
              const isSelected = c.date === selected;
              const a11y = c.state === 'none'
                ? `${dayNum} ${months[Number(c.date.slice(5, 7)) - 1]}`
                : t('rentalsOwner.calendar.cellLabel', {
                  date: `${dayNum} ${months[Number(c.date.slice(5, 7)) - 1]}`, out: c.out, q: quantity,
                });
              return (
                <Pressable
                  key={c.date}
                  onPress={() => onSelect(c.date)}
                  style={[
                    s.cell,
                    c.inMonth && c.state === 'partial' ? s.cellPartial : null,
                    c.inMonth && c.state === 'full' ? s.cellFull : null,
                    isSelected ? s.cellSelected : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={a11y}
                  testID={`Calendar-day-${c.date}`}
                >
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[s.num, !c.inMonth ? s.numOut : null, c.date < today ? s.numPast : null, isToday ? s.numToday : null]}>
                      {dayNum}
                    </Text>
                    {isToday ? <View style={s.todayDot} /> : null}
                  </View>
                  {c.inMonth ? rack(c) : <View style={s.rack} />}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
