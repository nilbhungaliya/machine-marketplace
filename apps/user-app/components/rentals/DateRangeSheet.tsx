import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RENTAL_LIMITS } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { useType } from '@/hooks/use-type';
import { formatMonthYear, weekdayShortNames } from '@/lib/format-date';
import { isLanguage } from '@/lib/i18n';
import { ChevronLeft, ChevronRight } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { dateRangeLabel } from '@/lib/rental-display';
import { addIsoDays, addMonths, monthGrid, monthOf, nextRangePick, rangeLength } from '@/lib/rental-dates';
import { radius, spacing, useTheme } from '@/lib/theme';

/** A picked start date, and the end date in range mode (IST calendar dates `YYYY-MM-DD`). */
export interface DateRangeValue {
  start: string;
  end?: string;
}

export interface DateRangeSheetProps {
  visible: boolean;
  /** `single`: Request booking's start date; `range`: search results' "Free on" dates. */
  mode: 'single' | 'range';
  value: DateRangeValue | null;
  /** Dates drawn greyed and not pickable (full days from `GET /listings/:id/availability`). */
  busy?: Set<string>;
  onClose: () => void;
  onPick: (v: DateRangeValue) => void;
}

/** How far ahead a start date can be (the `rental_advance_days` default, §16); "Free on" looks a year ahead. */
const SINGLE_AHEAD_DAYS = 180;
const RANGE_AHEAD_DAYS = 365;

/**
 * The calendar sheet (M14 spec §14.1, no mockup; built in the v2 language: lavender selection, violet ends, hairline
 * cells): a month at a time from this month, Sunday first, past days and full days greyed (a full day is struck
 * through). `single` picks a start date; `range` picks from and to (≤ 90 days, `RENTAL_LIMITS.freeOnMaxDays`) and a
 * single tap means one day. Done hands the pick back; the sheet never sends anything.
 */
export default function DateRangeSheet({ visible, mode, value, busy, onClose, onPick }: DateRangeSheetProps) {
  const { t, i18n } = useTranslation();
  const lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const { colors } = useTheme();
  const type = useType();
  const today = istDateKey();
  const last = addIsoDays(today, mode === 'single' ? SINGLE_AHEAD_DAYS : RANGE_AHEAD_DAYS);
  const [pick, setPick] = useState<DateRangeValue | null>(value);
  const [shown, setShown] = useState(() => monthOf(value?.start ?? today));

  useEffect(() => {
    if (!visible) return;
    setPick(value);
    setShown(monthOf(value?.start && value.start >= today ? value.start : today));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    month: { ...type('cardTitle'), color: colors.text },
    week: { flexDirection: 'row' },
    weekday: { flex: 1, textAlign: 'center', ...type('caption'), color: colors.textMuted, paddingVertical: spacing.xs },
    cell: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
    inRange: { backgroundColor: colors.primarySoft },
    rangeStart: { borderTopLeftRadius: radius.full, borderBottomLeftRadius: radius.full },
    rangeEnd: { borderTopRightRadius: radius.full, borderBottomRightRadius: radius.full },
    dot: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
    dotOn: { backgroundColor: colors.primary },
    dotToday: { borderWidth: 1, borderColor: colors.border },
    day: { ...type('bodyStrong'), color: colors.text },
    dayOn: { ...type('bodyStrong'), color: colors.onPrimary },
    dayOff: { ...type('body'), color: colors.textMuted },
    dayBusy: { ...type('body'), color: colors.textMuted, textDecorationLine: 'line-through' },
    legend: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
    legendText: { ...type('caption'), color: colors.textSecondary },
    summary: { ...type('bodyStrong'), color: colors.text },
  }), [colors, type]);

  const weeks = monthGrid(shown.year, shown.month);
  const firstOfShown = `${shown.year}-${String(shown.month + 1).padStart(2, '0')}-01`;
  const canBack = firstOfShown > today;
  const nextMonth = addMonths(shown, 1);
  const canForward = `${nextMonth.year}-${String(nextMonth.month + 1).padStart(2, '0')}-01` <= last;
  const days = weekdayShortNames();
  const end = pick?.end ?? pick?.start;

  const tap = (date: string) => {
    if (mode === 'single') setPick({ start: date });
    else setPick((cur) => nextRangePick(cur, date, RENTAL_LIMITS.freeOnMaxDays));
  };

  const done = () => {
    if (!pick) return;
    onPick(mode === 'single' ? { start: pick.start } : { start: pick.start, end: pick.end ?? pick.start });
    onClose();
  };

  const summary = pick
    ? mode === 'single'
      ? dateRangeLabel(pick.start, pick.start, lang)
      : t('rentals.dates.rangeSummary', { dates: dateRangeLabel(pick.start, end!, lang), count: rangeLength(pick.start, end!) })
    : t(mode === 'single' ? 'rentals.dates.tapStart' : 'rentals.dates.tapRange');

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(mode === 'single' ? 'rentals.dates.pickStart' : 'rentals.dates.pickRange')}
      testID="DateRange-backdrop"
    >
      <View style={s.nav}>
        <IconButton
          icon={ChevronLeft}
          variant="outline"
          onPress={() => canBack && setShown(addMonths(shown, -1))}
          accessibilityLabel={t('rentals.dates.prevMonth')}
          testID="DateRange-prev"
        />
        <Text style={s.month}>{formatMonthYear(Date.UTC(shown.year, shown.month, 1))}</Text>
        <IconButton
          icon={ChevronRight}
          variant="outline"
          onPress={() => canForward && setShown(nextMonth)}
          accessibilityLabel={t('rentals.dates.nextMonth')}
          testID="DateRange-next"
        />
      </View>
      <View>
        <View style={s.week}>
          {days.map((d) => <Text key={d} style={s.weekday}>{d}</Text>)}
        </View>
        {weeks.map((week, wi) => (
          <View key={wi} style={s.week}>
            {week.map((date, di) => {
              if (!date) return <View key={`p${di}`} style={s.cell} />;
              const isBusy = !!busy?.has(date);
              const off = date < today || date > last || isBusy;
              const isStart = pick?.start === date;
              const isEnd = !!pick && end === date;
              const inside = !!pick && !!end && date >= pick.start && date <= end && pick.start !== end;
              const on = isStart || isEnd;
              return (
                <View
                  key={date}
                  style={[s.cell, inside && s.inRange, inside && isStart && s.rangeStart, inside && isEnd && s.rangeEnd]}
                >
                  <Pressable
                    onPress={() => tap(date)}
                    disabled={off}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: off }}
                    accessibilityLabel={isBusy ? t('rentals.dates.fullA11y', { date: dateRangeLabel(date, date, lang) }) : dateRangeLabel(date, date, lang)}
                    style={[s.dot, on && s.dotOn, !on && date === today && s.dotToday]}
                    testID={`DateRange-day-${date}`}
                  >
                    <Text style={on ? s.dayOn : isBusy ? s.dayBusy : off ? s.dayOff : s.day}>{Number(date.slice(8))}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {busy && busy.size > 0 ? (
        <View style={s.legend}>
          <Text style={s.dayBusy}>{'14'}</Text>
          <Text style={s.legendText}>{t('rentals.dates.fullLegend')}</Text>
        </View>
      ) : null}
      <Text style={s.summary}>{summary}</Text>
      <Button title={t('rentals.dates.done')} onPress={done} disabled={!pick} phLabel="DateRange-done" />
    </BottomSheet>
  );
}
