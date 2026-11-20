import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { RentalBookingActionKey, RentalBookingStatus, RentalBookingView } from '@mpm/shared-types';
import { RENTAL_DECLINE_REASONS } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { useConfirm } from '@/components/ConfirmSheet';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import Notice from '@/components/Notice';
import PressableScale from '@/components/PressableScale';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { useOnReconnect } from '@/components/SocketProvider';
import StatusChip from '@/components/StatusChip';
import ContactBlock from '@/components/deals/ContactBlock';
import BookingMoney from '@/components/rentals/BookingMoney';
import BookingNotesSheet from '@/components/rentals/BookingNotesSheet';
import BookingTimeline from '@/components/rentals/BookingTimeline';
import CancelBookingSheet from '@/components/rentals/CancelBookingSheet';
import OnSiteSheet from '@/components/rentals/OnSiteSheet';
import OwnerAnswerBar from '@/components/rentals/OwnerAnswerBar';
import RenterAnswerBar from '@/components/rentals/RenterAnswerBar';
import ReturnSheet from '@/components/rentals/ReturnSheet';
import { invalidateAfterBooking, useBookingWrite, useRentalBooking, useRentalBookingPhotos } from '@/hooks/use-rental-booking';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { formatDate, formatDayMonth, formatTime } from '@/lib/format-date';
import { isLanguage } from '@/lib/i18n';
import {
  CalendarClock, Clock, Gauge, Info, MapPin, Package, Pencil, ShieldCheck, Star, TriangleAlert,
} from '@/lib/icons';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { formatRupees } from '@/lib/money';
import { qk } from '@/lib/query-keys';
import { bookingStatusChip, dateRangeLabel } from '@/lib/rental-display';
import { confirmBookingReturn } from '@/lib/rentals-api';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** Refetching expired photo URLs (300 s) at most this often. */
const PHOTO_REFRESH_GAP_MS = 10_000;

/** Statuses after a confirmation: the money, notes and contact block apply. */
const AGREED: readonly RentalBookingStatus[] = ['confirmed', 'on_rent', 'returned', 'completed', 'disputed'];

/** The footer's main step, in the order a booking reaches them. */
const PRIMARY: readonly RentalBookingActionKey[] = ['on_site', 'return', 'confirm_return', 'review'];

/**
 * The Booking record (M14 spec §14.1; mockup rental · "Booking updates"): the head (machine, dates, length, operator,
 * the other business, status), a clash warning, how a closed booking ended, the open proposal with the reader's
 * answers (renter `RenterAnswerBar`, owner B3's `OwnerAnswerBar`), the money (estimate → agreed → final), the site
 * (the address reaches the owner only once confirmed, masked until the numbers are shared), on site / returned with
 * hour meters and photos, a problem with support, notes, the contact block, the review card and the timeline. The
 * footer: Message and the next step (Mark on site, Mark returned, Confirm return, Rate). Only the server's `actions`
 * show; a `viewer` sees none.
 */
export default function BookingRecordScreen({ navigation, route }: RootStackScreenProps<'BookingRecord'>) {
  const { bookingId } = route.params;
  const { t, i18n } = useTranslation();
  const lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const query = useRentalBooking(bookingId);
  const write = useBookingWrite(bookingId);
  const v = query.data;
  const photoCount = (v?.onSite?.photoCount ?? 0) + (v?.returned?.photoCount ?? 0) + (v?.dispute ? 1 : 0);
  const photos = useRentalBookingPhotos(bookingId, photoCount > 0);
  const [sheet, setSheet] = useState<'notes' | 'cancel' | 'onSite' | 'return' | null>(null);

  useOnReconnect(() => { void query.refetch(); });

  const lastPhotoRefresh = useRef(0);
  const onPhotoExpired = useCallback(() => {
    const now = Date.now();
    if (now - lastPhotoRefresh.current < PHOTO_REFRESH_GAP_MS) return;
    lastPhotoRefresh.current = now;
    void qc.invalidateQueries({ queryKey: qk.rentals.bookingPhotos(bookingId) });
  }, [qc, bookingId]);

  const s = useMemo(() => StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl * 3 },
    loading: { padding: spacing.lg, gap: spacing.md },
    skeleton: { height: 96, borderRadius: radius.xl },
    head: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    thumb: {
      width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    headBody: { flex: 1, gap: 2 },
    dates: { ...type('cardTitle'), color: colors.text },
    meta: { ...type('caption'), color: colors.textSecondary },
    ref: { ...type('mono'), color: colors.textMuted },
    chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
    card: { gap: spacing.xs },
    section: { ...type('section'), color: colors.text, marginBottom: spacing.xs },
    row: {
      flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.xs + 2,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    rowLast: { borderBottomWidth: 0 },
    label: { ...type('caption'), color: colors.textSecondary, flex: 1 },
    value: { ...type('bodyStrong'), color: colors.text, flex: 1, textAlign: 'right' },
    mono: { ...type('mono'), color: colors.text, flex: 1, textAlign: 'right' },
    body: { ...type('body'), color: colors.text },
    muted: { ...type('caption'), color: colors.textMuted },
    photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.photo },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    links: { alignItems: 'center', gap: spacing.xs },
  }), [colors, type]);

  if (!v) {
    const gone = query.isError && errorCode(query.error) === 'RENTAL_BOOKING_NOT_FOUND';
    return (
      <ScreenWrapper>
        <Header title={t('rentals.record.title')} />
        {query.isLoading ? (
          <View style={s.loading}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>
        ) : gone ? (
          <EmptyState icon={Package} title={t('rentals.record.goneTitle')} subtitle={t('rentals.errors.rentalBookingNotFound')} />
        ) : (
          <EmptyState
            icon={TriangleAlert}
            title={t('rentals.record.loadError')}
            subtitle={t('rentals.record.loadErrorBody')}
            ctaTitle={t('common.retry')}
            ctaPhLabel="Booking-retry"
            onCtaPress={() => void query.refetch()}
          />
        )}
      </ScreenWrapper>
    );
  }

  const can = (a: RentalBookingActionKey) => v.actions.includes(a);
  const chip = bookingStatusChip(v.status, v.side);
  const c = v.current;
  const agreed = AGREED.includes(v.status);
  const open = v.status === 'requested' || v.status === 'countered';
  const other = v.counterpart.tradeName;
  const when = (iso: string | null) => {
    if (!iso) return '';
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? '' : `${formatDayMonth(ms)}, ${formatTime(ms)}`;
  };
  const operatorText = t(c.withOperator ? 'rentals.record.withOperator' : 'rentals.record.withoutOperator');
  const lengthLine = [
    t(`rentals.duration.${c.period}`, { count: c.count }),
    c.machines > 1 ? t('rentals.machinesCount', { count: c.machines }) : null,
    operatorText,
  ].filter(Boolean).join(', ');

  const fail = (action: string) => (err: unknown) => {
    track(RENTAL_EVENTS.bookingActionFailed, { bookingId, action, reason: errorCode(err) });
    Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
  };

  const confirmReturn = async () => {
    const ok = await confirm({
      title: t('rentals.record.confirmReturnTitle'),
      message: v.finalAmountPaise != null
        ? t('rentals.record.confirmReturnBody', { amount: formatRupees(v.finalAmountPaise) })
        : t('rentals.record.confirmReturnBodyNoAmount'),
      confirmLabel: t('rentals.actions.confirm_return'),
    });
    if (!ok) return;
    write.mutate((key) => confirmBookingReturn(bookingId, key), {
      onSuccess: (next) => {
        track(RENTAL_EVENTS.bookingAction, { bookingId, action: 'confirm_return', status: next.status });
        Toast.show({ type: 'success', text1: t('rentals.record.returnConfirmed') });
      },
      onError: fail('confirm_return'),
    });
  };

  const run: Partial<Record<RentalBookingActionKey, () => void>> = {
    on_site: () => setSheet('onSite'),
    return: () => setSheet('return'),
    confirm_return: () => void confirmReturn(),
    review: () => navigation.navigate('ReviewDeal', { subject: 'rental', id: bookingId }),
  };
  const primary = PRIMARY.find((a) => can(a)) ?? null;

  // A sheet of B3's handed back the fresh view.
  const stepDone = (action: RentalBookingActionKey) => (next: RentalBookingView) => {
    qc.setQueryData(qk.rentals.booking(bookingId), next);
    invalidateAfterBooking(qc, next);
    track(RENTAL_EVENTS.bookingAction, { bookingId, action, status: next.status });
    setSheet(null);
  };

  const ended = endedNotice(v, t);
  const proposalRows: { key: string; label: string; value: string }[] = [
    { key: 'dates', label: t('rentals.record.dates'), value: dateRangeLabel(c.startDate, c.endDate, lang) },
    { key: 'length', label: t('rentals.record.length'), value: t(`rentals.duration.${c.period}`, { count: c.count }) },
    { key: 'machines', label: t('rentals.record.machines'), value: String(c.machines) },
    { key: 'operator', label: t('rentals.form.operator'), value: operatorText },
    { key: 'transport', label: t('rentals.form.transport'), value: t(c.ownerDelivers ? 'rentals.form.ownerDelivers' : 'rentals.record.renterPicksUp') },
    { key: 'total', label: t('rentals.money.total'), value: formatRupees(c.totalPaise) },
  ];

  const siteLines = [
    t('rentals.record.siteIn', { city: v.site.city, state: v.site.state, pincode: v.site.pincode }),
    v.site.distanceKm != null ? t('rentals.record.siteDistance', { km: v.site.distanceKm }) : null,
  ].filter(Boolean) as string[];

  return (
    <ScreenWrapper>
      <Header title={t('rentals.record.title')} />
      <ScrollView contentContainerStyle={s.content} testID="BookingRecord-screen">
        <Card>
          <PressableScale
            onPress={() => navigation.navigate('Listing', { listingId: v.listing.id })}
            style={s.head}
            accessibilityRole="button"
            testID="Booking-listing"
          >
            <View style={s.thumb}>
              {v.listing.thumbUrl ? (
                <Image source={{ uri: v.listing.thumbUrl }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
              ) : (
                <Package size={24} color={colors.textMuted} />
              )}
            </View>
            <View style={s.headBody}>
              <Text style={s.dates}>{dateRangeLabel(c.startDate, c.endDate, lang)}</Text>
              <Text style={s.meta}>{lengthLine}</Text>
              <Text style={s.meta} numberOfLines={2}>
                {`${v.listing.title}, ${t(v.side === 'renter' ? 'rentals.record.fromOwner' : 'rentals.record.toRenter', { name: other })}`}
              </Text>
              <Text style={s.ref}>{`#${v.ref}`}</Text>
              <View style={s.chips}>
                <StatusChip label={t(chip.key)} tone={chip.tone} />
                {v.counterpart.verified ? <StatusChip label={t('deals.record.gstVerified')} tone="ok" icon={ShieldCheck} /> : null}
              </View>
            </View>
          </PressableScale>
        </Card>

        {v.role === 'viewer' ? <Notice tone="info" icon={Info} text={t('rentals.record.viewerOnly')} /> : null}
        {v.clashWith ? (
          <Notice tone="warning" icon={TriangleAlert} text={t('rentals.record.clash', { ref: v.clashWith.ref })} />
        ) : null}
        {ended ? <Notice tone={ended.tone} icon={Info} title={ended.title} text={ended.text} /> : null}
        {v.status === 'returned' && v.side === 'renter' && v.autoCompleteAt ? (
          <Notice tone="info" icon={Clock} text={t('rentals.record.returnedRenter', { date: formatDate(Date.parse(v.autoCompleteAt)) })} />
        ) : null}

        {open ? (
          <Card style={s.card}>
            <View style={s.titleRow}>
              <Text style={s.section}>
                {t(c.proposedBy === 'owner' ? 'rentals.record.ownerChange' : c.seq === 1 ? 'rentals.record.request' : 'rentals.record.renterChange')}
              </Text>
              {v.changeCount > 0 ? <StatusChip label={t('rentals.record.changesLeft', { count: v.changesLeft })} tone="neutral" /> : null}
            </View>
            {proposalRows.map((r, i) => (
              <View key={r.key} style={[s.row, i === proposalRows.length - 1 && s.rowLast]}>
                <Text style={s.label}>{r.label}</Text>
                <Text style={s.value}>{r.value}</Text>
              </View>
            ))}
            {c.message ? <Text style={s.body}>{c.message}</Text> : null}
            {c.messageFlagged && c.proposedBy !== v.side ? <Notice tone="danger" icon={TriangleAlert} text={t('offers.card.scam')} /> : null}
            {v.replyDueAt ? <Text style={s.muted}>{t('rentals.record.replyBy', { when: when(v.replyDueAt) })}</Text> : null}
            {v.side === 'renter' ? <RenterAnswerBar view={v} /> : null}
            {v.side === 'owner' && v.status === 'requested' && (can('confirm') || can('decline')) ? (
              <OwnerAnswerBar view={v} onDone={() => void query.refetch()} />
            ) : null}
          </Card>
        ) : null}

        <BookingMoney view={v} />

        <Card style={s.card}>
          <Text style={s.section}>{t('rentals.record.site')}</Text>
          {siteLines.map((l) => <Text key={l} style={s.body}>{l}</Text>)}
          {v.site.address ? (
            <View style={s.reviewRow}>
              <MapPin size={16} color={colors.textSecondary} />
              <Text style={[s.body, { flex: 1 }]}>{v.site.address}</Text>
            </View>
          ) : v.side === 'owner' ? (
            <Text style={s.muted}>{t(agreed ? 'rentals.record.addressNone' : 'rentals.record.addressAfterConfirm')}</Text>
          ) : null}
          {v.site.beyondServiceRadius ? <StatusChip label={t('rentals.record.beyondRadius')} tone="warn" /> : null}
        </Card>

        {v.onSite || v.returned ? (
          <Card style={s.card}>
            <Text style={s.section}>{t('rentals.record.onSiteTitle')}</Text>
            {v.onSite ? (
              <>
                <View style={s.row}>
                  <Text style={s.label}>{t('rentals.record.onSiteAt', { actor: t(v.onSite.bySide === v.side ? 'rentals.actor.you' : `rentals.actor.${v.onSite.bySide}`) })}</Text>
                  <Text style={s.value}>{when(v.onSite.at)}</Text>
                </View>
                {v.onSite.hourMeter != null ? (
                  <View style={s.row}>
                    <Text style={s.label}>{t('rentals.record.hourMeterOpen')}</Text>
                    <Text style={s.mono}>{String(v.onSite.hourMeter)}</Text>
                  </View>
                ) : null}
                <PhotoRow urls={photos.data?.onSite} style={s.photos} imageStyle={s.photo} onError={onPhotoExpired} />
              </>
            ) : null}
            {v.returned ? (
              <>
                <View style={s.row}>
                  <Text style={s.label}>{t('rentals.record.returnedAt')}</Text>
                  <Text style={s.value}>{when(v.returned.at)}</Text>
                </View>
                {v.returned.hourMeter != null ? (
                  <View style={s.row}>
                    <Text style={s.label}>{t('rentals.record.hourMeterClose')}</Text>
                    <Text style={s.mono}>{String(v.returned.hourMeter)}</Text>
                  </View>
                ) : null}
                {v.onSite?.hourMeter != null && v.returned.hourMeter != null ? (
                  <View style={[s.row, s.rowLast]}>
                    <View style={[s.reviewRow, { flex: 1 }]}>
                      <Gauge size={16} color={colors.textSecondary} />
                      <Text style={s.label}>{t('rentals.record.hoursRun')}</Text>
                    </View>
                    <Text style={s.mono}>{String(v.returned.hourMeter - v.onSite.hourMeter)}</Text>
                  </View>
                ) : null}
                {v.returned.damageNote ? (
                  <Notice tone="warning" icon={TriangleAlert} title={t('rentals.record.damage')} text={v.returned.damageNote} />
                ) : null}
                <PhotoRow urls={photos.data?.returned} style={s.photos} imageStyle={s.photo} onError={onPhotoExpired} />
              </>
            ) : null}
          </Card>
        ) : null}

        {v.dispute ? (
          <Card style={s.card}>
            <Text style={s.section}>{t('rentals.record.problemTitle')}</Text>
            <Text style={s.body}>
              {v.dispute.outcome
                ? t(`rentals.outcome.${v.dispute.outcome}`)
                : t('rentals.record.problemOpen')}
            </Text>
            <PhotoRow urls={photos.data?.problem} style={s.photos} imageStyle={s.photo} onError={onPhotoExpired} />
          </Card>
        ) : null}

        {agreed ? (
          <Card style={s.card}>
            <View style={s.titleRow}>
              <Text style={s.section}>{t('rentals.notes.title')}</Text>
              {can('edit_notes') ? (
                <Button title={t('rentals.notes.edit')} onPress={() => setSheet('notes')} variant="ghost" size="sm" icon={Pencil} phLabel="Booking-notes-edit" />
              ) : null}
            </View>
            <NotesRows view={v} labelStyle={s.label} valueStyle={s.value} rowStyle={s.row} textStyle={s.body} emptyStyle={s.muted} />
          </Card>
        ) : null}

        {agreed ? (
          <ContactBlock
            threadId={v.threadId}
            counterpartName={other}
            contact={v.contact}
            canShare={can('share_contact')}
            onShareClosed={() => void qc.invalidateQueries({ queryKey: qk.rentals.booking(bookingId) })}
          />
        ) : null}

        {v.status === 'completed' && v.review ? (
          <Card style={s.card}>
            <View style={s.reviewRow}>
              <Star size={18} color={colors.star} fill={colors.star} />
              <Text style={s.section}>{t('rentals.review.title')}</Text>
            </View>
            <Text style={s.body}>
              {t(v.review.mine ? 'rentals.review.done' : v.review.eligible ? `rentals.review.rate_${v.side}` : 'rentals.review.closed')}
            </Text>
            {can('review') ? (
              <Button title={t('rentals.actions.review')} onPress={run.review!} size="md" phLabel="Booking-review-rate" />
            ) : null}
          </Card>
        ) : null}

        <Card style={s.card}>
          <View style={s.reviewRow}>
            <CalendarClock size={18} color={colors.primaryInk} />
            <Text style={s.section}>{t('rentals.timeline.title')}</Text>
          </View>
          <BookingTimeline view={v} />
        </Card>

        <View style={s.links}>
          {can('report_problem') ? (
            <Button
              title={t('rentals.actions.report_problem')}
              onPress={() => navigation.navigate('ReportProblem', { subject: 'rental', id: bookingId })}
              variant="ghost"
              size="sm"
              phLabel="Booking-report-problem"
            />
          ) : null}
          {can('cancel') ? (
            <Button title={t('rentals.actions.cancel')} onPress={() => setSheet('cancel')} variant="ghost" size="sm" phLabel="Booking-cancel" />
          ) : null}
        </View>
      </ScrollView>

      <FooterBar>
        <Button
          title={t(v.side === 'renter' ? 'rentals.record.messageOwner' : 'rentals.record.messageRenter')}
          onPress={() => navigation.navigate('Thread', { threadId: v.threadId })}
          variant={primary ? 'outline' : 'primary'}
          size="md"
          phLabel="Booking-message"
        />
        {primary ? (
          <Button
            title={t(`rentals.actions.${primary}`)}
            onPress={run[primary]!}
            size="md"
            loading={write.isPending && primary === 'confirm_return'}
            disabled={write.isPending}
            phLabel={`Booking-${primary}`}
          />
        ) : null}
      </FooterBar>

      {agreed ? <BookingNotesSheet view={v} visible={sheet === 'notes'} onClose={() => setSheet(null)} /> : null}
      {can('cancel') ? <CancelBookingSheet view={v} visible={sheet === 'cancel'} onClose={() => setSheet(null)} /> : null}
      {can('on_site') ? (
        <OnSiteSheet view={v} visible={sheet === 'onSite'} onClose={() => setSheet(null)} onDone={stepDone('on_site')} />
      ) : null}
      {can('return') ? (
        <ReturnSheet view={v} visible={sheet === 'return'} onClose={() => setSheet(null)} onDone={stepDone('return')} />
      ) : null}
    </ScreenWrapper>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How a closed booking ended (§6.5): declined with the reason, withdrawn, expired, cancelled by whom and why, completed how. */
function endedNotice(v: RentalBookingView, t: Translate): { tone: 'success' | 'info'; title: string; text: string } | null {
  const by = (side: string) => (side === v.side ? t('rentals.actor.you') : t(`rentals.actor.${side}`));
  switch (v.status) {
    case 'completed':
      return { tone: 'success', title: t('rentals.status.completed'), text: t(`rentals.completedHow.${v.completedHow ?? 'auto'}`) };
    case 'declined':
      return {
        tone: 'info',
        title: t('rentals.status.declined'),
        text: declineText(v.declineReason, t),
      };
    case 'withdrawn':
      return { tone: 'info', title: t('rentals.status.withdrawn'), text: t('rentals.record.withdrawn') };
    case 'expired':
      return { tone: 'info', title: t('rentals.status.expired'), text: t('rentals.record.expired') };
    case 'cancelled': {
      const x = v.cancelled;
      const parts = x
        ? [t('rentals.record.cancelledBy', { actor: by(x.bySide) }), x.reason ? t(`rentals.cancelReason.${x.reason}`) : '', x.note ?? '']
        : [];
      return { tone: 'info', title: t('rentals.status.cancelled'), text: parts.filter(Boolean).join(' · ') };
    }
    default:
      return null;
  }
}

/**
 * Why a request was declined: the owner's reason, else a system reason (owner inactive, GST ended, a block, the listing
 * removed), which shares its copy with the cancel reasons, else the plain "declined" line — never a raw key.
 */
function declineText(reason: RentalBookingView['declineReason'], t: Translate): string {
  if (!reason) return t('rentals.record.declined');
  if ((RENTAL_DECLINE_REASONS as readonly string[]).includes(reason)) return t(`rentals.declineReason.${reason}`);
  return t(`rentals.cancelReason.${reason}`, { defaultValue: t('rentals.record.declined') });
}

/** The signed photos of one step (300 s URLs; a load error refetches them). */
function PhotoRow({ urls, style, imageStyle, onError }: {
  urls: string[] | undefined;
  style: object;
  imageStyle: object;
  onError: () => void;
}) {
  if (!urls?.length) return null;
  return (
    <View style={style}>
      {urls.map((u) => (
        <Image key={u} source={{ uri: u }} style={imageStyle} contentFit="cover" cachePolicy="memory" onError={onError} accessibilityIgnoresInvertColors />
      ))}
    </View>
  );
}

/** The notes as label / value rows (R10), "Nothing noted yet" when empty. */
function NotesRows({ view, labelStyle, valueStyle, rowStyle, textStyle, emptyStyle }: {
  view: RentalBookingView;
  labelStyle: object;
  valueStyle: object;
  rowStyle: object;
  textStyle: object;
  emptyStyle: object;
}) {
  const { t } = useTranslation();
  const n = view.notes;
  const rows = [
    n.paymentMethod ? { key: 'pay', label: t('rentals.notes.payment'), value: t(`deals.payment.${n.paymentMethod}`) } : null,
    n.advancePaise != null ? { key: 'adv', label: t('rentals.notes.advance'), value: formatRupees(n.advancePaise) } : null,
    n.depositPaise != null
      ? {
        key: 'dep',
        label: t('rentals.notes.deposit'),
        value: `${formatRupees(n.depositPaise)}${n.depositReturned ? ` · ${t('rentals.notes.returned')}` : ''}`,
      }
      : null,
    n.expectedOnSiteTime ? { key: 'time', label: t('rentals.notes.time'), value: n.expectedOnSiteTime } : null,
  ].filter((r): r is { key: string; label: string; value: string } => r !== null);
  if (rows.length === 0 && !n.text) return <Text style={emptyStyle}>{t('rentals.notes.empty')}</Text>;
  return (
    <>
      {rows.map((r) => (
        <View key={r.key} style={rowStyle}>
          <Text style={labelStyle}>{r.label}</Text>
          <Text style={valueStyle}>{r.value}</Text>
        </View>
      ))}
      {n.text ? <Text style={textStyle}>{n.text}</Text> : null}
      {n.textFlagged ? <Notice tone="danger" icon={TriangleAlert} text={t('offers.card.scam')} /> : null}
    </>
  );
}
