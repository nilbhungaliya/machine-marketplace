import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { DealView } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Notice from '@/components/Notice';
import PressableScale from '@/components/PressableScale';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { useConfirm } from '@/components/ConfirmSheet';
import { useOnReconnect } from '@/components/SocketProvider';
import CancelRequestBanner from '@/components/deals/CancelRequestBanner';
import CancelSheet from '@/components/deals/CancelSheet';
import ContactBlock from '@/components/deals/ContactBlock';
import HandoverSheet from '@/components/deals/HandoverSheet';
import NotesCard from '@/components/deals/NotesCard';
import NotesSheet from '@/components/deals/NotesSheet';
import Timeline from '@/components/deals/Timeline';
import { useDeal, useDealWrite } from '@/hooks/use-deals';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { DEAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { dealActionButtons, dealStatusChip, deadlineCopy, reviewCardState, timelineRows, type DealFooterAction } from '@/lib/deal-display';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { Clock, Info, Package, ShieldCheck, Star, TriangleAlert } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import { formatPaiseText, gstLabelKey } from '@/lib/offer-form';
import { formatQuantity } from '@/lib/quantity';
import { qk } from '@/lib/query-keys';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** Refetching the deal for an expired handover photo URL at most this often (as the chat thread does). */
const PHOTO_REFRESH_GAP_MS = 10_000;

/**
 * The Deal record (F6 + F7 spec §9.1, §15.1; mockups deals · "Deal record", "Handed over"): listing and counterpart,
 * the agreed terms ("Payment happens outside the app"), the handed-over callout with its deadlines, a pending cancel
 * request, a problem report, the shared notes, the contact block, the review card once completed, the timeline, and
 * the reader's actions — only those the server offers (`view.actions`).
 */
export default function DealRecordScreen({ navigation, route }: RootStackScreenProps<'DealRecord'>) {
  const { dealId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const query = useDeal(dealId);
  const write = useDealWrite(dealId);
  const [sheet, setSheet] = useState<'notes' | 'handover' | 'cancel' | 'request' | null>(null);

  useOnReconnect(() => { void query.refetch(); });

  // The handover photo is a signed URL (300 s): a load error refetches the deal for a fresh one, at most every 10 s.
  const lastPhotoRefresh = useRef(0);
  const onPhotoExpired = useCallback(() => {
    const now = Date.now();
    if (now - lastPhotoRefresh.current < PHOTO_REFRESH_GAP_MS) return;
    lastPhotoRefresh.current = now;
    void qc.invalidateQueries({ queryKey: qk.deal(dealId) });
  }, [qc, dealId]);

  const s = useMemo(() => StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.md },
    loading: { padding: spacing.lg, gap: spacing.md },
    skeleton: { height: 96, borderRadius: radius.xl },
    head: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    thumb: {
      width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    headBody: { flex: 1, gap: 2 },
    title: { ...type('cardTitle'), color: colors.text },
    meta: { ...type('caption'), color: colors.textSecondary },
    ref: { ...type('mono'), color: colors.textMuted },
    chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
    card: { gap: spacing.xs },
    section: { ...type('section'), color: colors.text, marginBottom: spacing.xs },
    row: {
      flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    rowLast: { borderBottomWidth: 0 },
    label: { ...type('caption'), color: colors.textSecondary, flex: 1 },
    value: { ...type('bodyStrong'), color: colors.text, flex: 1, textAlign: 'right' },
    body: { ...type('body'), color: colors.text },
    photo: { width: 120, height: 120, borderRadius: radius.md, backgroundColor: colors.photo },
    reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    links: { alignItems: 'center', gap: spacing.xs },
  }), [colors, type]);

  const deal = query.data;
  if (!deal) {
    const gone = query.isError && errorCode(query.error) === 'DEAL_NOT_FOUND';
    return (
      <ScreenWrapper>
        <Header title={t('deals.record.title')} />
        {query.isLoading ? (
          <View style={s.loading}>
            <Skeleton style={s.skeleton} />
            <Skeleton style={s.skeleton} />
            <Skeleton style={s.skeleton} />
          </View>
        ) : gone ? (
          <EmptyState icon={Package} title={t('deals.record.goneTitle')} subtitle={t('errors.trade.dealNotFound')} />
        ) : (
          <EmptyState
            icon={TriangleAlert}
            title={t('deals.list.errorTitle')}
            subtitle={t('deals.list.errorBody')}
            ctaTitle={t('common.retry')}
            ctaPhLabel="Deal-retry"
            onCtaPress={() => void query.refetch()}
          />
        )}
      </ScreenWrapper>
    );
  }

  const buttons = dealActionButtons(deal);
  const chip = dealStatusChip(deal.status);
  const deadlines = deadlineCopy(deal, Date.now());
  const review = reviewCardState(deal);
  const gst = gstLabelKey(deal.gstMode);
  const qty = `${formatQuantity(deal.quantity)} ${deal.unitLabel}`.trim();
  const busy = write.isPending;
  const fail = (err: unknown) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) });

  const confirmReceived = async () => {
    const ok = await confirm({
      title: t('deals.received.title'),
      message: t('deals.received.body', { name: deal.counterpart.name }),
      confirmLabel: t('deals.actions.confirm_received'),
    });
    if (!ok) return;
    write.mutate({ action: 'confirm_received' }, {
      onSuccess: () => {
        track(DEAL_EVENTS.receivedConfirmed, {});
        Toast.show({ type: 'success', text1: t('deals.received.done') });
      },
      onError: fail,
    });
  };

  const acceptCancelRequest = async () => {
    const ok = await confirm({
      title: t('deals.cancelRequest.acceptTitle'),
      message: t('deals.cancelRequest.acceptBody'),
      confirmLabel: t('deals.cancelRequest.accept'),
      destructive: true,
    });
    if (!ok) return;
    write.mutate({ action: 'accept_cancel_request' }, {
      onSuccess: () => {
        track(DEAL_EVENTS.cancelled, { side: deal.side, reason: deal.cancelRequest?.reason ?? 'other' });
        Toast.show({ type: 'success', text1: t('deals.cancel.done') });
      },
      onError: fail,
    });
  };

  const clearCancelRequest = async () => {
    const mine = deal.cancelRequest?.side === deal.side;
    const ok = await confirm({
      title: t(mine ? 'deals.cancelRequest.withdrawTitle' : 'deals.cancelRequest.declineTitle'),
      confirmLabel: t(mine ? 'deals.cancelRequest.withdraw' : 'deals.cancelRequest.decline'),
    });
    if (!ok) return;
    write.mutate({ action: 'clear_cancel_request' }, {
      onSuccess: () => Toast.show({ type: 'success', text1: t('deals.cancelRequest.cleared') }),
      onError: fail,
    });
  };

  const footerRun: Record<DealFooterAction, () => void> = {
    hand_over: () => setSheet('handover'),
    confirm_received: () => void confirmReceived(),
    cancel: () => setSheet('cancel'),
    report_problem: () => navigation.navigate('ReportProblem', { subject: 'deal', id: dealId }),
  };

  const termRows = [
    { key: 'price', label: t('deals.record.price'), value: t('deals.record.each', { price: formatRupees(deal.pricePerUnitPaise) }) },
    { key: 'qty', label: t('deals.record.quantity'), value: qty },
    { key: 'total', label: t('deals.record.total'), value: [formatPaiseText(deal.totalPaise), gst ? t(gst) : ''].filter(Boolean).join(' ') },
    { key: 'payment', label: t('deals.record.payment'), value: t('deals.record.outsideApp') },
  ];

  const statusLine = statusNotice(deal, t);

  return (
    <ScreenWrapper>
      <Header title={t('deals.record.title')} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: spacing.xxxl * 3 }]} testID="Deal-record">
        <Card>
          <PressableScale
            onPress={() => navigation.navigate('Listing', { listingId: deal.listingId })}
            style={s.head}
            accessibilityRole="button"
            testID="Deal-listing"
          >
            <View style={s.thumb}>
              {deal.thumbUrl ? (
                <Image source={{ uri: deal.thumbUrl }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
              ) : (
                <Package size={24} color={colors.textMuted} />
              )}
            </View>
            <View style={s.headBody}>
              <Text style={s.title} numberOfLines={2}>{deal.listingTitle}</Text>
              <Text style={s.meta}>{t(deal.side === 'buyer' ? 'deals.record.withSeller' : 'deals.record.withBuyer', { name: deal.counterpart.name })}</Text>
              <Text style={s.ref}>{`#${deal.ref}`}</Text>
              <View style={s.chips}>
                <StatusChip label={t(chip.key)} tone={chip.tone} />
                {deal.counterpart.gstVerified ? <StatusChip label={t('deals.record.gstVerified')} tone="ok" icon={ShieldCheck} /> : null}
              </View>
            </View>
          </PressableScale>
        </Card>

        {deadlines ? (
          <Notice
            tone="info"
            icon={Clock}
            title={deal.side === 'buyer' ? t('deals.handover.calloutTitle', { name: deal.counterpart.name }) : undefined}
            text={deal.side === 'buyer'
              ? deadlines.reportUntil
                ? t('deals.handover.calloutBuyer', { until: deadlines.reportUntil, on: deadlines.completesOn ?? '' })
                : t('deals.handover.calloutBuyerLate', { on: deadlines.completesOn ?? '' })
              : t('deals.handover.calloutSeller', { on: deadlines.completesOn ?? '' })}
          />
        ) : null}

        {deal.cancelRequest && deal.status === 'handed_over' ? (
          <CancelRequestBanner
            request={deal.cancelRequest}
            mySide={deal.side}
            canAccept={buttons.cancelRequest.accept}
            canClear={buttons.cancelRequest.clear}
            busy={busy}
            onAccept={() => void acceptCancelRequest()}
            onClear={() => void clearCancelRequest()}
          />
        ) : null}

        {statusLine ? <Notice tone={statusLine.tone} icon={Info} title={statusLine.title} text={statusLine.text} /> : null}

        {deal.dispute ? (
          <Card style={s.card}>
            <Text style={s.section}>{t('deals.dispute.title')}</Text>
            <Text style={s.meta}>
              {t('deals.dispute.by', { side: t(`deals.actor.${deal.dispute.openedBySide}`), category: t(`deals.category.${deal.dispute.category}`) })}
            </Text>
            <Text style={s.body}>{deal.dispute.description}</Text>
            {deal.dispute.outcome ? (
              <Text style={s.meta}>{t('deals.dispute.resolved', { outcome: t(`deals.outcome.${deal.dispute.outcome}`) })}</Text>
            ) : (
              <Text style={s.meta}>{t('deals.dispute.open')}</Text>
            )}
            {deal.dispute.messageToParties ? <Text style={s.body}>{deal.dispute.messageToParties}</Text> : null}
          </Card>
        ) : null}

        <Card style={s.card}>
          <Text style={s.section}>{t('deals.record.terms')}</Text>
          {termRows.map((r, i) => (
            <View key={r.key} style={[s.row, i === termRows.length - 1 && s.rowLast]}>
              <Text style={s.label}>{r.label}</Text>
              <Text style={s.value}>{r.value}</Text>
            </View>
          ))}
        </Card>

        {deal.handover ? (
          <Card style={s.card}>
            <Text style={s.section}>{t('deals.handover.detailTitle')}</Text>
            {deal.handover.photo ? (
              <Image
                source={{ uri: deal.handover.photo.url }}
                style={s.photo}
                contentFit="cover"
                cachePolicy="memory"
                onError={onPhotoExpired}
                accessibilityIgnoresInvertColors
              />
            ) : null}
            {deal.handover.note ? <Text style={s.body}>{deal.handover.note}</Text> : null}
            {!deal.handover.photo && !deal.handover.note ? <Text style={s.meta}>{t('deals.handover.noDetail')}</Text> : null}
          </Card>
        ) : null}

        <NotesCard notes={deal.notes} canEdit={buttons.editNotes} onEdit={() => setSheet('notes')} />

        <ContactBlock
          threadId={deal.threadId}
          counterpartName={deal.counterpart.name}
          contact={deal.contact}
          canShare={buttons.shareContact}
          onShareClosed={() => void qc.invalidateQueries({ queryKey: qk.deal(dealId) })}
        />

        {review ? (
          <Card style={s.card}>
            <View style={s.reviewRow}>
              <Star size={18} color={colors.star} fill={colors.star} />
              <Text style={s.section}>{t('deals.review.title')}</Text>
            </View>
            <Text style={s.body}>{t(`deals.review.body.${review.kind}`)}</Text>
            {review.kind === 'rate' ? (
              <Button
                title={t('deals.review.rate')}
                onPress={() => navigation.navigate('ReviewDeal', { subject: 'deal', id: dealId })}
                size="md"
                phLabel="Deal-review-rate"
              />
            ) : null}
          </Card>
        ) : null}

        <Card style={s.card}>
          <Text style={s.section}>{t('deals.timeline.title')}</Text>
          <Timeline rows={timelineRows(deal.timeline, deal)} />
        </Card>

        <View style={s.links}>
          {buttons.requestCancel ? (
            <Button title={t('deals.actions.request_cancel')} onPress={() => setSheet('request')} variant="ghost" size="sm" phLabel="Deal-request-cancel" />
          ) : null}
          <Button
            title={t('deals.record.openChat')}
            onPress={() => navigation.navigate('Thread', { threadId: deal.threadId })}
            variant="ghost"
            size="sm"
            phLabel="Deal-open-chat"
          />
        </View>
      </ScrollView>

      {buttons.primary || buttons.secondary ? (
        <FooterBar>
          {buttons.secondary ? (
            <Button
              title={t(`deals.actions.${buttons.secondary}`)}
              onPress={footerRun[buttons.secondary]}
              variant="outline"
              size="md"
              disabled={busy}
              phLabel={`Deal-${buttons.secondary}`}
            />
          ) : null}
          {buttons.primary ? (
            <Button
              title={t(`deals.actions.${buttons.primary}`)}
              onPress={footerRun[buttons.primary]}
              size="md"
              loading={busy && buttons.primary === 'confirm_received'}
              disabled={busy}
              phLabel={`Deal-${buttons.primary}`}
            />
          ) : null}
        </FooterBar>
      ) : null}

      <NotesSheet deal={deal} visible={sheet === 'notes'} onClose={() => setSheet(null)} />
      <HandoverSheet dealId={dealId} buyerName={deal.counterpart.name} visible={sheet === 'handover'} onClose={() => setSheet(null)} />
      <CancelSheet dealId={dealId} side={deal.side} mode="cancel" visible={sheet === 'cancel'} onClose={() => setSheet(null)} />
      <CancelSheet dealId={dealId} side={deal.side} mode="request" visible={sheet === 'request'} onClose={() => setSheet(null)} />
    </ScreenWrapper>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How a final deal ended (§9.4, §9.5): completed how, or cancelled by whom and why. */
function statusNotice(deal: DealView, t: Translate): { tone: 'success' | 'info'; title: string; text: string } | null {
  if (deal.status === 'completed') {
    return {
      tone: 'success',
      title: t('deals.status.completed'),
      text: t(`deals.completedHow.${deal.completedHow ?? 'auto'}`),
    };
  }
  if (deal.status === 'cancelled') {
    const by = deal.cancelledBySide ? t(`deals.cancelledBy.${deal.cancelledBySide}`) : '';
    const reason = deal.cancelReason ? t(`deals.cancelReason.${deal.cancelReason}`) : '';
    return {
      tone: 'info',
      title: t('deals.status.cancelled'),
      text: [by, reason, deal.cancelNote ?? ''].filter(Boolean).join(' · '),
    };
  }
  return null;
}
