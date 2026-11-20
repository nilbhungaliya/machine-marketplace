import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEAL_LIMITS, type ReviewState } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { REVIEW_EVENTS } from '@/lib/analytics-events';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { formatDate } from '@/lib/format-date';
import { Clock, Info, TriangleAlert } from '@/lib/icons';
import { newInstallId } from '@/lib/install-id';
import { formatRupees } from '@/lib/money';
import { qk } from '@/lib/query-keys';
import { reviewFacets, reviewHasText, validateReview } from '@/lib/review-form';
import { fetchDealForReview, fetchReviewState, submitReview } from '@/lib/reviews-api';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import { Stars, StarInput } from './review-parts';

/**
 * Review a completed deal (F6 + F7 spec §10; mockup deals · "Review"): the buyer rates the seller on three facets with
 * optional public text; the seller rates the buyer on three facets, stars only (kept on record, not shown yet, §10.4).
 * Blind: a submitted review shows only to its author until both have reviewed or its wait runs out ("published when
 * both have reviewed, or 7 days after the first"). Opened from the Deal record's review card (L7) and the
 * `review_waiting` notification.
 */
export default function ReviewDealScreen({ navigation, route }: RootStackScreenProps<'ReviewDeal'>) {
  // M14-STUB(B2): `subject: 'rental'` reads the booking's review routes (B2-4); C0-5 reads the deal subject only.
  const { id: dealId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: qk.reviewState(dealId), queryFn: () => fetchReviewState(dealId), staleTime: 0 });
  const deal = useQuery({ queryKey: qk.deal(dealId), queryFn: () => fetchDealForReview(dealId) });
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  // One key per form: a retried tap after a lost response replays the stored reply instead of `409 REVIEW_EXISTS`.
  const [idempotencyKey] = useState(newInstallId);
  const submit = useMutation({
    mutationFn: (body: { ratings: Record<string, number>; text?: string }) => submitReview(dealId, body, idempotencyKey),
  });

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
    dealHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    dealArt: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.photo },
    dealText: { flex: 1, gap: 2 },
    dealName: { ...type('cardTitle'), color: colors.text },
    dealSub: { ...type('caption'), color: colors.textSecondary },
    facets: { gap: spacing.xs },
    error: { ...type('caption'), color: colors.danger },
    fine: { ...type('caption'), color: colors.textMuted },
    mineCard: { gap: spacing.sm },
    mineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    mineTitle: { ...type('cardTitle'), color: colors.text },
    facetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    facetLabel: { ...type('body'), color: colors.text, flexShrink: 1 },
    mineText: { ...type('body'), color: colors.textSecondary },
    skeleton: { height: 260, borderRadius: radius.xl },
  }), [colors, type]);

  const view = state.data;
  const side = view?.mySide ?? deal.data?.side ?? 'buyer';
  const title = side === 'buyer' ? t('reviews.reviewSeller') : t('reviews.reviewBuyer');
  const check = validateReview(side, { ratings, text });
  const missing = !check.ok && check.problems.some((p) => p.problem === 'missing');
  const tooLong = !check.ok && check.problems.some((p) => p.field === 'text');

  const send = () => {
    setTried(true);
    if (!check.ok) return;
    submit.mutate(check.body, {
      onSuccess: (next: ReviewState) => {
        qc.setQueryData(qk.reviewState(dealId), next);
        void qc.invalidateQueries({ queryKey: qk.deal(dealId) });
        void qc.invalidateQueries({ queryKey: qk.allDeals });
        track(REVIEW_EVENTS.reviewSubmitted, { side });
        Toast.show({ type: 'success', text1: t('reviews.submitted') });
      },
      onError: (err) => {
        Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
        void state.refetch();
      },
    });
  };

  const dealHead = deal.data ? (
    <Card style={s.dealHead}>
      <View style={s.dealArt} />
      <View style={s.dealText}>
        <Text style={s.dealName} numberOfLines={1}>{deal.data.counterpart.name}</Text>
        <Text style={s.dealSub} numberOfLines={2}>{`${deal.data.listingTitle}, ${formatRupees(Number(deal.data.totalPaise))}`}</Text>
      </View>
    </Card>
  ) : null;

  let content: React.ReactNode;
  let footer: React.ReactNode = null;
  if (state.isLoading) {
    content = <Skeleton style={s.skeleton} />;
  } else if (!view) {
    content = (
      <EmptyState
        icon={TriangleAlert}
        title={t('reviews.loadError')}
        subtitle={state.error ? f6ErrorMessage(state.error) : ''}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Review-retry"
        onCtaPress={() => void state.refetch()}
      />
    );
  } else if (view.mine) {
    // Blind (§10.3): only its author sees it until it publishes.
    const mine = view.mine;
    const due = view.publishDueAt ? Date.parse(view.publishDueAt) : null;
    content = (
      <>
        {dealHead}
        <Card style={s.mineCard}>
          <View style={s.mineHead}>
            <Text style={s.mineTitle}>{t('reviews.mine.title')}</Text>
            {mine.hidden ? (
              <StatusChip label={t('reviews.mine.hidden')} tone="neutral" />
            ) : mine.publishedAt ? (
              <StatusChip label={t('reviews.mine.published')} tone="ok" />
            ) : null}
          </View>
          {reviewFacets(view.mySide).map((facet) => (
            <View key={facet} style={s.facetRow}>
              <Text style={s.facetLabel}>{t(`reviews.facet.${facet}`)}</Text>
              <Stars filled={mine.ratings[facet] ?? 0} />
            </View>
          ))}
          {mine.text ? <Text style={s.mineText}>{mine.text}</Text> : null}
        </Card>
        {!mine.publishedAt && !mine.hidden ? (
          <Notice
            tone="info"
            icon={Clock}
            text={due ? t('reviews.mine.waiting', { date: formatDate(due) }) : t('reviews.mine.waitingNoDate')}
          />
        ) : null}
        {view.mySide === 'seller' ? <Notice tone="info" icon={Info} text={t('reviews.buyerPrivate')} /> : null}
      </>
    );
    footer = (
      <FooterBar>
        <Button title={t('common.done')} onPress={() => navigation.goBack()} size="md" phLabel="Review-done" />
      </FooterBar>
    );
  } else if (!view.eligible) {
    content = (
      <>
        {dealHead}
        <Notice tone="info" icon={Info} text={t(`reviews.closed.${view.reason ?? 'not_completed'}`)} />
      </>
    );
  } else {
    const end = view.windowEndsAt ? Date.parse(view.windowEndsAt) : null;
    content = (
      <>
        {dealHead}
        <View style={s.facets}>
          {reviewFacets(view.mySide).map((facet) => (
            <StarInput
              key={facet}
              label={t(`reviews.facet.${facet}`)}
              value={ratings[facet]}
              onChange={(n) => setRatings((r) => ({ ...r, [facet]: n }))}
              testID={`Review-star-${facet}`}
            />
          ))}
          {tried && missing ? <Text style={s.error}>{t('reviews.ratingsMissing')}</Text> : null}
        </View>
        {reviewHasText(view.mySide) ? (
          <Input
            label={t('reviews.textLabel')}
            placeholder={t('reviews.textHint')}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={DEAL_LIMITS.reviewTextMax + 50}
            error={tooLong ? t('reviews.textTooLong', { max: DEAL_LIMITS.reviewTextMax }) : undefined}
            testID="Review-text"
          />
        ) : (
          <Notice tone="info" icon={Info} text={t('reviews.buyerPrivate')} />
        )}
        {view.theirsSubmitted ? <Notice tone="success" text={t('reviews.theirsIn')} /> : null}
        <Text style={s.fine}>{t('reviews.blindNote')}</Text>
        {end ? <Text style={s.fine}>{t('reviews.windowEnds', { date: formatDate(end) })}</Text> : null}
      </>
    );
    footer = (
      <FooterBar>
        <Button title={t('reviews.submit')} onPress={send} loading={submit.isPending} size="md" phLabel="Review-submit" />
      </FooterBar>
    );
  }

  return (
    <ScreenWrapper keyboardAware>
      <Header title={title} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{content}</ScrollView>
      {footer}
    </ScreenWrapper>
  );
}
