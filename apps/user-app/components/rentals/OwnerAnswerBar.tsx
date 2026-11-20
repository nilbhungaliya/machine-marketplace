import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { RentalBookingView } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import Notice from '@/components/Notice';
import DeclineSheet from '@/components/rentals/DeclineSheet';
import ProposeChangeSheet from '@/components/rentals/ProposeChangeSheet';
import { useRentalBookingWrite } from '@/hooks/use-rental-calendar';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { formatDayMonth, formatTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/i18n/language';
import { Clock, TriangleAlert } from '@/lib/icons';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { formatRupees } from '@/lib/money';
import { dateRangeLabel } from '@/lib/rental-display';
import { confirmBooking } from '@/lib/rentals-api';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface OwnerAnswerBarProps {
  /** The owner's view of a `requested` booking: Confirm / Propose change / Decline (by `view.actions`). */
  view: RentalBookingView;
  /** After any answer landed (the caller refetches or stores the fresh view). */
  onDone: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The owner's answer to a request (§6.1, §6.3): the open version's total, the reply deadline and the changes left,
 * then Confirm (a confirm sheet with the dates, machines and total; capacity is checked, `409 RENTAL_DATES_TAKEN`),
 * Propose change (while changes are left) and Decline. Nothing for a renter, a `viewer` or any other status: the
 * buttons come from `view.actions`, and the server checks each again.
 */
export default function OwnerAnswerBar({ view, onDone, style }: OwnerAnswerBarProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const lang = useLanguage();
  const confirm = useConfirm();
  const write = useRentalBookingWrite(view.id);
  const [sheet, setSheet] = useState<'change' | 'decline' | null>(null);

  const s = useMemo(() => StyleSheet.create({
    box: {
      backgroundColor: colors.primaryWash, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md,
      borderWidth: 1, borderColor: colors.hairline,
    },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
    title: { ...type('cardTitle'), color: colors.text },
    total: { ...type('price'), color: colors.text },
    meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    metaText: { ...type('caption'), color: colors.textSecondary },
    row: { flexDirection: 'row', gap: spacing.sm },
    half: { flex: 1 },
  }), [colors, type]);

  const actions = view.actions;
  if (view.side !== 'owner' || !actions.includes('confirm')) return null;

  const v = view.current;
  const dates = dateRangeLabel(v.startDate, v.endDate, lang);
  const due = view.replyDueAt ? Date.parse(view.replyDueAt) : null;

  const runConfirm = async () => {
    const ok = await confirm({
      title: t('rentalsOwner.answer.confirmTitle'),
      message: t('rentalsOwner.answer.confirmMessage', {
        dates, count: v.machines, total: formatRupees(v.totalPaise),
      }),
      confirmLabel: t('rentalsOwner.answer.confirm'),
    });
    if (!ok) return;
    write.mutate((key) => confirmBooking(view.id, { versionSeq: v.seq }, key), {
      onSuccess: (fresh) => {
        track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'confirm', status: fresh.status });
        Toast.show({ type: 'success', text1: t('rentalsOwner.answer.confirmed') });
        onDone();
      },
      onError: (err) => {
        track(RENTAL_EVENTS.bookingActionFailed, { bookingId: view.id, action: 'confirm', reason: errorCode(err) });
        Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
        onDone();
      },
    });
  };

  return (
    <View style={[s.box, style]} testID="OwnerAnswerBar">
      <View style={s.head}>
        <Text style={s.title}>{t('rentalsOwner.answer.title')}</Text>
        <Text style={s.total} testID="OwnerAnswer-total">{formatRupees(v.totalPaise)}</Text>
      </View>
      {due != null ? (
        <View style={s.meta}>
          <Clock size={14} color={colors.textSecondary} />
          <Text style={s.metaText}>
            {t('rentalsOwner.answer.replyBy', { date: formatDayMonth(due), time: formatTime(due) })}
          </Text>
        </View>
      ) : null}
      <Text style={s.metaText}>
        {view.changesLeft > 0
          ? t('rentalsOwner.answer.changesLeft', { count: view.changesLeft })
          : t('rentalsOwner.answer.noChangesLeft')}
      </Text>
      {view.site.beyondServiceRadius ? (
        <Notice tone="warning" icon={TriangleAlert} text={t('rentalsOwner.answer.beyondRadius')} />
      ) : null}
      <Button
        title={t('rentalsOwner.answer.confirm')}
        onPress={() => void runConfirm()}
        loading={write.isPending}
        size="md"
        phLabel="OwnerAnswer-confirm"
      />
      <View style={s.row}>
        {actions.includes('change') ? (
          <Button
            title={t('rentalsOwner.answer.change')}
            onPress={() => setSheet('change')}
            variant="outline"
            size="md"
            style={s.half}
            disabled={write.isPending}
            phLabel="OwnerAnswer-change"
          />
        ) : null}
        {actions.includes('decline') ? (
          <Button
            title={t('rentalsOwner.answer.decline')}
            onPress={() => setSheet('decline')}
            variant="outline"
            size="md"
            style={s.half}
            disabled={write.isPending}
            phLabel="OwnerAnswer-decline"
          />
        ) : null}
      </View>

      <ProposeChangeSheet
        view={view}
        visible={sheet === 'change'}
        onClose={() => setSheet(null)}
        onSent={() => onDone()}
      />
      <DeclineSheet
        bookingId={view.id}
        versionSeq={v.seq}
        visible={sheet === 'decline'}
        onClose={() => setSheet(null)}
        onDone={() => onDone()}
      />
    </View>
  );
}
