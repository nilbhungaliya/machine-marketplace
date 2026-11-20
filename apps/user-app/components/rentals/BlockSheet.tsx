import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { RENTAL_BLOCK_REASONS, RENTAL_LIMITS, type RentalBlockReason, type RentalBlockView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import { useConfirm } from '@/components/ConfirmSheet';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import DateRangeSheet from '@/components/rentals/DateRangeSheet';
import { useRentalBlockWrite } from '@/hooks/use-rental-calendar';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorDetails } from '@/lib/api-error';
import { useLanguage } from '@/lib/i18n/language';
import { CalendarClock, TriangleAlert } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { blockFormErrors, blockMachines } from '@/lib/rental-calendar';
import { dateRangeLabel } from '@/lib/rental-display';
import { hasFormErrors } from '@/lib/rental-return';
import { radius, spacing, useTheme } from '@/lib/theme';

interface BlockSheetProps {
  listingId: string;
  /** Machines on the listing. */
  quantity: number;
  /** The block being edited; null adds one. */
  block: RentalBlockView | null;
  /** A new block starts on this day (the day picked on the calendar). */
  initialDate: string | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * Add or edit a calendar block (§7.3, R5): dates, how many machines, a reason (maintenance, booked outside the app —
 * the retired "Mark rented" —, other) and a note. Create and edit check capacity against confirmed bookings: `409
 * RENTAL_DATES_TAKEN` shows in the sheet with the fewest machines free. Editing offers Delete.
 */
export default function BlockSheet({ listingId, quantity, block, initialDate, visible, onClose }: BlockSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const lang = useLanguage();
  const confirm = useConfirm();
  const write = useRentalBlockWrite(listingId);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [machines, setMachines] = useState('1');
  const [reason, setReason] = useState<RentalBlockReason>('maintenance');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [picking, setPicking] = useState(false);
  const [taken, setTaken] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    const today = istDateKey();
    const first = initialDate && initialDate >= today ? initialDate : today;
    setStart(block?.startDate ?? first);
    setEnd(block?.endDate ?? first);
    setMachines(String(block?.machines ?? Math.max(1, quantity)));
    setReason(block?.reason ?? 'maintenance');
    setNote(block?.note ?? '');
    setTried(false);
    setTaken(null);
  }, [visible, block, initialDate, quantity]);

  const s = useMemo(() => StyleSheet.create({
    dateField: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52,
      backgroundColor: colors.field, borderRadius: radius.md, paddingHorizontal: spacing.lg,
    },
    dateValue: { ...type('fieldValue'), color: colors.text, flex: 1 },
    datePlaceholder: { color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    hint: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const errors = blockFormErrors({ startDate: start, endDate: end, machines, note }, quantity, istDateKey(), block);
  const shown = tried ? errors : {};

  const datesError = shown.dates === 'past'
    ? t('rentalsOwner.block.datesPast')
    : shown.dates === 'tooLong'
      ? t('rentalsOwner.block.datesTooLong', { max: RENTAL_LIMITS.blockRangeMaxDays })
      : shown.dates ? t('rentalsOwner.block.datesRequired') : undefined;

  const save = () => {
    setTried(true);
    const m = blockMachines(machines);
    if (hasFormErrors(errors) || !start || !end || m == null) return;
    const trimmed = note.trim();
    const input = { startDate: start, endDate: end, machines: m, reason, ...(trimmed || block?.note ? { note: trimmed } : {}) };
    const created = block == null;
    write.mutate(created ? { type: 'create', input } : { type: 'update', blockId: block.id, input }, {
      onSuccess: () => {
        track(RENTAL_EVENTS.blockSaved, { listingId, reason, created });
        Toast.show({ type: 'success', text1: t(created ? 'rentalsOwner.block.added' : 'rentalsOwner.block.saved') });
        onClose();
      },
      onError: (err) => {
        if (errorCode(err) === 'RENTAL_DATES_TAKEN') {
          const free = errorDetails(err).free;
          setTaken(typeof free === 'number' ? free : 0);
          return;
        }
        Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
      },
    });
  };

  const remove = async () => {
    if (!block) return;
    const ok = await confirm({
      title: t('rentalsOwner.block.deleteTitle'),
      message: t('rentalsOwner.block.deleteMessage'),
      confirmLabel: t('rentalsOwner.block.delete'),
      destructive: true,
    });
    if (!ok) return;
    write.mutate({ type: 'delete', blockId: block.id }, {
      onSuccess: () => {
        track(RENTAL_EVENTS.blockDeleted, { listingId, reason: block.reason });
        Toast.show({ type: 'success', text1: t('rentalsOwner.block.deleted') });
        onClose();
      },
      onError: (err) => Toast.show({ type: 'error', text1: m14ErrorMessage(err) }),
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(block ? 'rentalsOwner.block.editTitle' : 'rentalsOwner.block.addTitle')}
      subtitle={t('rentalsOwner.block.subtitle')}
      testID="Block-backdrop"
    >
      <Field label={t('rentalsOwner.block.dates')} error={datesError}>
        <Pressable style={s.dateField} onPress={() => setPicking(true)} accessibilityRole="button" testID="Block-dates">
          <CalendarClock size={20} color={colors.primaryInk} />
          <Text style={[s.dateValue, !start || !end ? s.datePlaceholder : null]}>
            {start && end ? dateRangeLabel(start, end, lang) : t('rentalsOwner.block.pickDates')}
          </Text>
        </Pressable>
      </Field>
      <Input
        label={t('rentalsOwner.block.machines')}
        value={machines}
        onChangeText={(v) => { setMachines(v); setTaken(null); }}
        keyboardType="number-pad"
        error={shown.machines ? t('rentalsOwner.block.machinesInvalid', { max: Math.max(1, quantity) }) : undefined}
        testID="Block-machines"
      />
      {!shown.machines ? <Text style={s.hint}>{t('rentalsOwner.block.machinesHint', { count: quantity })}</Text> : null}
      <Field label={t('rentalsOwner.block.reason')}>
        <View style={s.chips}>
          {RENTAL_BLOCK_REASONS.map((r) => (
            <Chip
              key={r}
              label={t(`rentalsOwner.blockReason.${r}`)}
              selected={reason === r}
              onPress={() => setReason(r)}
              role="radio"
              testID={`Block-reason-${r}`}
            />
          ))}
        </View>
      </Field>
      <Input
        label={t('rentalsOwner.block.note')}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={t('rentalsOwner.block.noteHint')}
        error={shown.note ? t('rentalsOwner.tooLong', { max: RENTAL_LIMITS.blockNoteMax }) : undefined}
        testID="Block-note"
      />
      {taken != null ? (
        <Notice
          tone="danger"
          icon={TriangleAlert}
          title={t('rentals.errors.rentalDatesTaken')}
          text={t('rentalsOwner.block.takenFree', { count: taken })}
        />
      ) : null}
      <Button title={t('rentalsOwner.block.save')} onPress={save} loading={write.isPending} phLabel="Block-save" />
      {block ? (
        <Button
          title={t('rentalsOwner.block.delete')}
          onPress={() => void remove()}
          variant="ghost"
          disabled={write.isPending}
          phLabel="Block-delete"
        />
      ) : null}

      <DateRangeSheet
        visible={picking}
        mode="range"
        value={start ? { start, ...(end ? { end } : {}) } : null}
        onClose={() => setPicking(false)}
        onPick={(v) => {
          setPicking(false);
          setTaken(null);
          setStart(v.start);
          setEnd(v.end ?? v.start);
        }}
      />
    </BottomSheet>
  );
}
