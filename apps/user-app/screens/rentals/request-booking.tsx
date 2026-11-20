import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  RENTAL_LIMITS, meetsRentalMinimum, rentalCountLimits, rentalEstimate, resolveRentalChoices,
  type RentalBookingView, type RentalEstimateResult, type RentalPeriod, type RentalTermsSnapshot,
} from '@mpm/shared-types';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import Field, { FieldError, FieldHint } from '@/components/Field';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import PressableScale from '@/components/PressableScale';
import ScreenWrapper from '@/components/ScreenWrapper';
import SegmentedControl from '@/components/SegmentedControl';
import Skeleton from '@/components/Skeleton';
import DateRangeSheet from '@/components/rentals/DateRangeSheet';
import EstimateCard from '@/components/rentals/EstimateCard';
import { useBusiness, usePincodeInfo } from '@/hooks/use-business';
import { useListing } from '@/hooks/use-listing';
import { useIdempotencyKey } from '@/hooks/use-offers';
import {
  invalidateAfterBooking, useBookingWrite, useRentalAvailability, useRentalBooking, useRentalEstimate,
} from '@/hooks/use-rental-booking';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { formatDateWithWeekday } from '@/lib/format-date';
import { CalendarClock, MapPin, Package, TriangleAlert } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { qk } from '@/lib/query-keys';
import { addIsoDays, busyDates, rangeFromStart, rangeHasFullDay } from '@/lib/rental-dates';
import { periodLabelKey } from '@/lib/rental-display';
import {
  asksOperator, asksTransport, periodsOffered, pincodeDigits, rentalRequestSchema, rentalRequestValues,
  toEstimateRequest, toRentalChangeInput, toRentalRequestInput, validateRentalRequest, type RentalRequestValues,
} from '@/lib/rental-request-form';
import { proposeBookingChange, requestBooking } from '@/lib/rentals-api';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** The date sheet's busy days: the availability window's maximum (92 days) from today. */
const BUSY_WINDOW_DAYS = RENTAL_LIMITS.availabilityMaxDays - 1;

/** `YYYY-MM-DD` → "Thu, 21 Nov 2026" (IST noon, so the day can't slip). */
const dayText = (date: string) => formatDateWithWeekday(Date.parse(`${date}T12:00:00+05:30`));

/**
 * Request booking (M14 spec §14.1, §6.2; mockup rental · "Booking request"): From / To (the start from the calendar
 * sheet, full days greyed; the end follows the period), Charged by (the periods the listing prices), how many, machines
 * (when the listing has more than one), operator and transport only when the listing leaves them to the renter, the
 * site pincode ("Use my business location") and an optional address shared only once the owner confirms, a note; the
 * live estimate under it; Send request → the Booking record. In change mode (`change`, from a Booking record's
 * Change) the same form answers the owner's version with a changed request: no site, the note is the message.
 */
export default function RequestBookingScreen({ navigation, route }: RootStackScreenProps<'RequestBooking'>) {
  const { listingId, prefill, change } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const listingQuery = useListing(listingId);
  const listing = listingQuery.data;
  const bookingQuery = useRentalBooking(change?.bookingId ?? '', !!change);
  const booking = change ? bookingQuery.data : undefined;
  const business = useBusiness(!change);
  const today = istDateKey();
  const availability = useRentalAvailability(listingId, { from: today, to: addIsoDays(today, BUSY_WINDOW_DAYS) });
  const busy = useMemo(() => busyDates(availability.data), [availability.data]);

  // A change keeps the terms the booking was made on; a request reads the listing's.
  const terms: RentalTermsSnapshot | null = change ? booking?.terms ?? null : listing?.rental ?? null;
  const quantity = Math.max(1, Math.floor(Number(listing?.quantity ?? '1')) || 1);

  const [values, setValues] = useState<RentalRequestValues | null>(null);
  const [tried, setTried] = useState(false);
  const [dates, setDates] = useState(false);
  /** The server refused the start date (`RENTAL_DATES_INVALID`: too far ahead); shown under the date until a new pick. */
  const [startRefused, setStartRefused] = useState(false);

  useEffect(() => {
    if (values || !terms) return;
    const merged = change && booking
      ? {
        startDate: booking.current.startDate,
        period: booking.current.period,
        count: booking.current.count,
        machines: booking.current.machines,
        withOperator: booking.current.withOperator,
        ownerDelivers: booking.current.ownerDelivers,
        ...prefill,
      }
      : prefill;
    // A start date already past (the booking's own, or a prefill's) is asked again rather than shown as an error.
    const base = merged?.startDate && merged.startDate < today ? { ...merged, startDate: undefined } : merged;
    setValues(rentalRequestValues(terms, base));
  }, [terms, booking]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    track(RENTAL_EVENTS.requestStarted, { listingId, change: !!change });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "Use my business location" once the business is in and the pincode is still empty.
  const businessPin = business.data?.location.pincode ?? null;
  const pin = values ? pincodeDigits(values.sitePincode) : null;
  const pinInfo = usePincodeInfo(change ? null : pin);

  // A change is priced on the booking's terms snapshot (the server does the same), so it is computed here; a request
  // asks the server, which also reads the listing's calendar and the site's distance.
  const estimateInput = !change && values && terms ? toEstimateRequest(listingId, values, terms) : null;
  const estimate = useRentalEstimate(estimateInput);
  const localEstimate = useMemo((): RentalEstimateResult | null => {
    if (!change || !values || !terms || !values.startDate) return null;
    const choices = resolveRentalChoices(terms, values);
    const money = rentalEstimate(terms, { period: values.period, count: values.count, machines: values.machines, ...choices });
    if (!money) return null;
    return {
      ...money,
      ...choices,
      endDate: rangeFromStart(values.startDate, values.period, values.count).end,
      // Free and service-area checks are the owner's to make on a change: not shown here.
      free: true,
      beyondServiceRadius: null,
      minimumMet: meetsRentalMinimum(terms, values.period, values.count),
    };
  }, [change, values, terms]);

  const key = useIdempotencyKey();
  const send = useMutation({
    mutationFn: (v: RentalRequestValues) => requestBooking(listingId, toRentalRequestInput(v, terms!), key.take()),
    onSuccess: (view: RentalBookingView) => {
      key.settle();
      qc.setQueryData(qk.rentals.booking(view.id), view);
      invalidateAfterBooking(qc, view);
    },
    onError: (err) => key.settle(err),
  });
  const changeWrite = useBookingWrite(change?.bookingId ?? '');

  const s = useMemo(() => StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl * 3 },
    loading: { padding: spacing.lg, gap: spacing.md },
    skeleton: { height: 64, borderRadius: radius.md },
    title: { ...type('cardTitle'), color: colors.text },
    two: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    dateBox: {
      minHeight: 52, borderRadius: radius.md, backgroundColor: colors.field, paddingHorizontal: spacing.md,
      justifyContent: 'center', borderWidth: 1.5, borderColor: colors.field,
    },
    dateBoxError: { borderColor: colors.danger },
    dateValue: { ...type('fieldValue'), color: colors.text },
    datePlaceholder: { ...type('fieldValue'), color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    useBusiness: { alignSelf: 'flex-start' },
    single: { ...type('bodyStrong'), color: colors.text },
  }), [colors, type]);

  if (!listing || !terms || !values) {
    const failed = listingQuery.isError || (change ? bookingQuery.isError : false);
    return (
      <ScreenWrapper>
        <Header title={t(change ? 'rentals.request.changeTitle' : 'rentals.request.title')} />
        {failed ? (
          <EmptyState
            icon={TriangleAlert}
            title={t('rentals.request.loadError')}
            subtitle={t('rentals.request.loadErrorBody')}
            ctaTitle={t('common.retry')}
            ctaPhLabel="RequestBooking-retry"
            onCtaPress={() => { void listingQuery.refetch(); if (change) void bookingQuery.refetch(); }}
          />
        ) : listing && !listing.rental ? (
          <EmptyState icon={Package} title={t('rentals.request.notBookableTitle')} subtitle={t('rentals.errors.listingNotBookable')} />
        ) : (
          <View style={s.loading}>
            {[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}
          </View>
        )}
      </ScreenWrapper>
    );
  }

  const offered = periodsOffered(terms);
  const limits = rentalCountLimits[values.period];
  const range = values.startDate ? rangeFromStart(values.startDate, values.period, values.count) : null;
  const datesFull = range ? rangeHasFullDay(range.start, range.end, busy) : false;
  const schema = rentalRequestSchema(t, terms, quantity, {
    today,
    change: !!change,
    noteMax: change ? RENTAL_LIMITS.messageMax : RENTAL_LIMITS.requestNoteMax,
  });
  const errors = validateRentalRequest(schema, values);
  const shownErrors = tried ? errors : {};

  const set = (patch: Partial<RentalRequestValues>) => setValues((v) => (v ? { ...v, ...patch } : v));
  const setPeriod = (period: RentalPeriod) => {
    const max = rentalCountLimits[period].max;
    set({ period, count: Math.min(values.count, max) });
  };

  const busyAll = send.isPending || changeWrite.isPending;

  const submit = () => {
    setTried(true);
    const first = Object.values(errors)[0];
    if (first) {
      Toast.show({ type: 'error', text1: first });
      return;
    }
    if (change) {
      changeWrite.mutate(
        (k) => proposeBookingChange(change.bookingId, toRentalChangeInput(values, terms, change.versionSeq), k),
        {
          onSuccess: (view) => {
            track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'change', status: view.status });
            Toast.show({ type: 'success', text1: t('rentals.request.changeSent') });
            navigation.goBack();
          },
          onError: (err) => {
            track(RENTAL_EVENTS.bookingActionFailed, { bookingId: change.bookingId, action: 'change', reason: errorCode(err) });
            if (errorCode(err) === 'RENTAL_DATES_INVALID') setStartRefused(true);
            else Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
          },
        },
      );
      return;
    }
    send.mutate(values, {
      onSuccess: (view) => {
        track(RENTAL_EVENTS.requestSent, {
          listingId, bookingId: view.id, period: values.period, count: values.count, machines: values.machines,
        });
        Toast.show({ type: 'success', text1: t('rentals.request.sent') });
        navigation.replace('BookingRecord', { bookingId: view.id });
      },
      onError: (err) => {
        track(RENTAL_EVENTS.requestFailed, { listingId, reason: errorCode(err) });
        if (errorCode(err) === 'RENTAL_DATES_INVALID') setStartRefused(true);
        else Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
        if (errorCode(err) === 'RENTAL_DATES_TAKEN') void availability.refetch();
      },
    });
  };

  return (
    <ScreenWrapper keyboardAware>
      <Header title={t(change ? 'rentals.request.changeTitle' : 'rentals.request.title')} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" testID="RequestBooking-screen">
        <Text style={s.title} numberOfLines={2}>{listing.title}</Text>
        {change ? <Notice tone="info" text={t('rentals.request.changeIntro')} /> : null}

        <Field error={shownErrors.startDate ?? (startRefused ? t('rentals.form.errors.startTooFar') : undefined)}>
          <View style={s.two}>
            <View style={s.half}>
              <Field label={t('rentals.form.from')}>
                <PressableScale
                  onPress={() => setDates(true)}
                  style={[s.dateBox, shownErrors.startDate || startRefused ? s.dateBoxError : null]}
                  accessibilityRole="button"
                  testID="RequestBooking-from"
                >
                  <Text style={values.startDate ? s.dateValue : s.datePlaceholder} numberOfLines={1}>
                    {values.startDate ? dayText(values.startDate) : t('rentals.form.pickDate')}
                  </Text>
                </PressableScale>
              </Field>
            </View>
            <View style={s.half}>
              <Field label={t('rentals.form.to')}>
                <View style={s.dateBox}>
                  <Text style={range ? s.dateValue : s.datePlaceholder} numberOfLines={1}>
                    {range ? dayText(range.end) : '–'}
                  </Text>
                </View>
              </Field>
            </View>
          </View>
        </Field>
        {datesFull ? <Notice tone="danger" icon={CalendarClock} text={t('rentals.form.datesFull')} /> : null}

        <Field label={t('rentals.form.chargedBy')} error={shownErrors.period}>
          {offered.length > 1 ? (
            <SegmentedControl
              options={offered.map((p) => ({ value: p, label: t(periodLabelKey(p)), testID: `RequestBooking-period-${p}` }))}
              value={values.period}
              onChange={setPeriod}
              accessibilityLabel={t('rentals.form.chargedBy')}
            />
          ) : (
            <Text style={s.single}>{t(periodLabelKey(values.period))}</Text>
          )}
        </Field>

        <Stepper
          label={t(`rentals.form.howMany.${values.period}`)}
          value={values.count}
          min={limits.min}
          max={limits.max}
          valueText={t(`rentals.duration.${values.period}`, { count: values.count })}
          onChange={(count) => set({ count })}
          error={shownErrors.count}
          testID="RequestBooking-count"
        />
        {quantity > 1 ? (
          <Stepper
            label={t('rentals.form.machines')}
            hint={t('rentals.form.machinesHint', { count: quantity })}
            value={values.machines}
            min={1}
            max={Math.min(quantity, RENTAL_LIMITS.machinesMax)}
            valueText={t('rentals.machinesCount', { count: values.machines })}
            onChange={(machines) => set({ machines })}
            error={shownErrors.machines}
            testID="RequestBooking-machines"
          />
        ) : null}

        {asksOperator(terms) ? (
          <Field label={t('rentals.form.operator')}>
            <View style={s.chips}>
              {[true, false].map((on) => (
                <Chip
                  key={String(on)}
                  label={t(on ? 'rentals.form.withOperator' : 'rentals.form.withoutOperator')}
                  selected={values.withOperator === on}
                  onPress={() => set({ withOperator: on })}
                  role="radio"
                  testID={`RequestBooking-operator-${on ? 'with' : 'without'}`}
                />
              ))}
            </View>
          </Field>
        ) : null}
        {asksTransport(terms) ? (
          <Field label={t('rentals.form.transport')}>
            <View style={s.chips}>
              {[true, false].map((on) => (
                <Chip
                  key={String(on)}
                  label={t(on ? 'rentals.form.ownerDelivers' : 'rentals.form.iPickUp')}
                  selected={values.ownerDelivers === on}
                  onPress={() => set({ ownerDelivers: on })}
                  role="radio"
                  testID={`RequestBooking-transport-${on ? 'owner' : 'self'}`}
                />
              ))}
            </View>
          </Field>
        ) : null}

        {!change ? (
          <>
            <View>
              <Input
                label={t('rentals.form.sitePincode')}
                value={values.sitePincode}
                onChangeText={(sitePincode) => set({ sitePincode })}
                keyboardType="number-pad"
                maxLength={6}
                error={shownErrors.sitePincode}
                testID="RequestBooking-pincode"
              />
              {pinInfo.data ? (
                <FieldHint>{t('rentals.form.siteIn', { city: pinInfo.data.city, state: pinInfo.data.state })}</FieldHint>
              ) : pin && pinInfo.isSuccess ? (
                <FieldError>{t('rentals.form.pincodeUnknown')}</FieldError>
              ) : null}
              {businessPin && values.sitePincode !== businessPin ? (
                <Button
                  title={t('rentals.form.useBusiness')}
                  onPress={() => set({ sitePincode: businessPin })}
                  variant="ghost"
                  size="sm"
                  icon={MapPin}
                  phLabel="RequestBooking-use-business"
                  style={s.useBusiness}
                />
              ) : null}
            </View>
            <View>
              <Input
                label={t('rentals.form.siteAddress')}
                value={values.siteAddress}
                onChangeText={(siteAddress) => set({ siteAddress })}
                placeholder={t('rentals.form.siteAddressHint')}
                maxLength={RENTAL_LIMITS.siteAddressMax + 20}
                error={shownErrors.siteAddress}
                testID="RequestBooking-address"
              />
              <FieldHint>{t('rentals.form.addressPrivate')}</FieldHint>
            </View>
          </>
        ) : null}

        <Input
          label={t(change ? 'rentals.form.message' : 'rentals.form.note')}
          value={values.note}
          onChangeText={(note) => set({ note })}
          multiline
          placeholder={t('rentals.form.noteHint')}
          error={shownErrors.note}
          testID="RequestBooking-note"
        />

        <EstimateCard
          estimate={change ? localEstimate : estimate.data && estimateInput ? estimate.data : null}
          period={values.period}
          count={values.count}
          machines={values.machines}
          terms={terms}
          loading={!change && estimate.isFetching}
          error={!change && estimate.isError}
          stale={!change && estimate.stale}
        />
      </ScrollView>
      <FooterBar>
        <Button
          title={t(change ? 'rentals.request.sendChange' : 'rentals.request.send')}
          onPress={submit}
          loading={busyAll}
          disabled={busyAll}
          size="md"
          phLabel="RequestBooking-send"
        />
      </FooterBar>
      <DateRangeSheet
        visible={dates}
        mode="single"
        value={values.startDate ? { start: values.startDate } : null}
        busy={busy}
        onClose={() => setDates(false)}
        onPick={(v) => { setStartRefused(false); set({ startDate: v.start }); }}
      />
    </ScreenWrapper>
  );
}

interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  /** The value in words ("3 days", "2 machines"). */
  valueText: string;
  onChange: (n: number) => void;
  error?: string;
  testID: string;
}

/** − value + with 44 dp buttons (the form's counts). */
function Stepper({ label, hint, value, min, max, valueText, onChange, error, testID }: StepperProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
      backgroundColor: colors.field, borderRadius: radius.md, padding: spacing.xs,
    },
    btn: {
      width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline,
    },
    btnOff: { opacity: 0.4 },
    glyph: { ...type('title'), color: colors.primaryInk },
    value: { ...type('fieldValue'), color: colors.text, flex: 1, textAlign: 'center' },
  }), [colors, type]);
  return (
    <Field label={label} hint={hint} error={error}>
      <View style={s.row}>
        <PressableScale
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          style={[s.btn, value <= min && s.btnOff]}
          accessibilityRole="button"
          accessibilityLabel={t('rentals.form.decrease', { label })}
          testID={`${testID}-minus`}
        >
          <Text style={s.glyph}>{'−'}</Text>
        </PressableScale>
        <Text style={s.value} accessibilityLiveRegion="polite">{valueText}</Text>
        <PressableScale
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          style={[s.btn, value >= max && s.btnOff]}
          accessibilityRole="button"
          accessibilityLabel={t('rentals.form.increase', { label })}
          testID={`${testID}-plus`}
        >
          <Text style={s.glyph}>{'+'}</Text>
        </PressableScale>
      </View>
    </Field>
  );
}
