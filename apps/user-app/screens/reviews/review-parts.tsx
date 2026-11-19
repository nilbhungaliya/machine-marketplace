import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useMutation } from '@tanstack/react-query';
import {
  DEAL_LIMITS, REVIEW_FACETS, REVIEW_REPORT_REASONS, type PublicReview, type ReviewReportReason, type SellerReviewsPage,
} from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Input from '@/components/Input';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { REVIEW_EVENTS } from '@/lib/analytics-events';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { formatDate } from '@/lib/format-date';
import { Star } from '@/lib/icons';
import { newInstallId } from '@/lib/install-id';
import { filledStars, replyProblem, scoreDisplay } from '@/lib/review-form';
import { replyToReview, reportReview } from '@/lib/reviews-api';
import { radius, spacing, useTheme } from '@/lib/theme';

// Shared pieces of the review screens (F6 + F7 spec §10; mockup deals · "Review", `.rate` / `.stars`).

/** Five stars, `filled` of them in the `star` colour (display only). */
export function Stars({ filled, size = 16, style }: { filled: number; size?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', gap: 2 }, style]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} color={i <= filled ? colors.star : colors.border} fill={i <= filled ? colors.star : colors.border} />
      ))}
    </View>
  );
}

/** One facet's row on the review form: its name, then five tappable stars (44 targets). */
export function StarInput({ label, value, onChange, testID }: { label: string; value: number | undefined; onChange: (n: number) => void; testID: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: { gap: spacing.xs, paddingVertical: spacing.sm },
    label: { ...type('bodyStrong'), color: colors.text },
    stars: { flexDirection: 'row', gap: spacing.xs },
    star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  }), [colors, type]);
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.stars} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value !== undefined && n <= value;
          return (
            <Pressable
              key={n}
              style={s.star}
              onPress={() => onChange(n)}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === n }}
              accessibilityLabel={t('reviews.starA11y', { facet: label, n })}
              testID={`${testID}-${n}`}
              hitSlop={2}
            >
              <Star size={30} color={on ? colors.star : colors.border} fill={on ? colors.star : colors.border} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The seller's score (§10.4): stars, one decimal, the count and a bar per facet; "New seller" below 3 published
 * reviews. Public.
 */
export function ScoreCard({ page, title, style }: { page: SellerReviewsPage; title?: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const score = scoreDisplay(page.score);
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.md },
    title: { ...type('label'), color: colors.textSecondary },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    big: { ...type('display'), color: colors.text },
    headText: { flex: 1, gap: spacing.xs },
    count: { ...type('caption'), color: colors.textSecondary },
    newTitle: { ...type('cardTitle'), color: colors.text },
    bar: { gap: spacing.xs },
    barHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    barLabel: { ...type('caption'), color: colors.text, flexShrink: 1 },
    barValue: { ...type('caption'), color: colors.textSecondary },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.field, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: colors.star },
  }), [colors, type]);

  return (
    <Card style={[s.card, style]}>
      {title ? <Text style={s.title}>{title}</Text> : null}
      {score.kind === 'new' || !page.score ? (
        <View style={s.headText}>
          <StatusChip label={t('reviews.newSeller')} tone="new" />
          <Text style={s.count}>{t('reviews.newSellerHint')}</Text>
        </View>
      ) : (
        <>
          <View style={s.head}>
            <Text style={s.big} accessibilityLabel={t('reviews.scoreA11y', { stars: score.stars })}>{score.stars}</Text>
            <View style={s.headText}>
              <Stars filled={score.filled} size={18} />
              <Text style={s.count}>{t('reviews.count', { count: score.count })}</Text>
            </View>
          </View>
          {REVIEW_FACETS.buyer.map((facet) => {
            const pct = page.score!.facetsPercent[facet];
            return (
              <View key={facet} style={s.bar}>
                <View style={s.barHead}>
                  <Text style={s.barLabel}>{t(`reviews.facet.${facet}`)}</Text>
                  <Text style={s.barValue}>{`${pct}%`}</Text>
                </View>
                <View style={s.track}><View style={[s.fill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} /></View>
              </View>
            );
          })}
        </>
      )}
    </Card>
  );
}

/** One published review: reviewer, deal title, stars, date, text and the seller's reply (all masked by the server). */
export function ReviewItem({ review, onReply, onReport, style }: {
  review: PublicReview;
  onReply?: () => void;
  onReport?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.sm },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { ...type('bodyStrong'), color: colors.text, flex: 1 },
    date: { ...type('caption'), color: colors.textMuted },
    about: { ...type('caption'), color: colors.textSecondary },
    text: { ...type('body'), color: colors.text },
    reply: { backgroundColor: colors.primaryWash, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
    replyLabel: { ...type('label'), color: colors.primaryInk },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  }), [colors, type]);

  return (
    <Card style={[s.card, style]}>
      <View style={s.head}>
        <Text style={s.name} numberOfLines={1}>{review.reviewerName}</Text>
        <Text style={s.date}>{formatDate(Date.parse(review.publishedAt))}</Text>
      </View>
      <Stars filled={filledStars(review.stars)} />
      <Text style={s.about} numberOfLines={1}>{t('reviews.about', { title: review.listingTitle })}</Text>
      {review.hidden ? <StatusChip label={t('reviews.mine.hidden')} tone="neutral" /> : null}
      {review.text ? <Text style={s.text}>{review.text}</Text> : null}
      {review.reply ? (
        <View style={s.reply}>
          <Text style={s.replyLabel}>{t('reviews.replyFrom')}</Text>
          <Text style={s.text}>{review.reply.text}</Text>
        </View>
      ) : null}
      {onReply || onReport ? (
        <View style={s.actions}>
          {onReport ? <Button title={t('reviews.report')} variant="ghost" size="sm" onPress={onReport} phLabel={`Review-report-${review.id}`} /> : null}
          {onReply ? <Button title={t('reviews.reply')} variant="outline" size="sm" onPress={onReply} phLabel={`Review-reply-${review.id}`} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Report a published review (§10.6): a reason and optional details. `REPORT_EXISTS` / `REPORT_LIMIT` say so. */
export function ReportReviewSheet({ reviewId, onClose }: { reviewId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [details, setDetails] = useState('');
  const send = useMutation({ mutationFn: (v: { id: string; reason: ReviewReportReason; details: string }) =>
    reportReview(v.id, { reason: v.reason, ...(v.details.trim() ? { details: v.details.trim() } : {}) }) });

  useEffect(() => {
    setReason(null);
    setDetails('');
  }, [reviewId]);

  const submit = () => {
    if (!reviewId) return;
    if (!reason) {
      Toast.show({ type: 'error', text1: t('reviews.reportSheet.reasonRequired') });
      return;
    }
    send.mutate({ id: reviewId, reason, details }, {
      onSuccess: () => {
        track(REVIEW_EVENTS.reviewReported, { reason });
        onClose();
        Toast.show({ type: 'success', text1: t('reviews.reportSheet.sent') });
      },
      onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
    });
  };

  return (
    <ActionSheet
      visible={reviewId !== null}
      title={t('reviews.reportSheet.title')}
      items={REVIEW_REPORT_REASONS.map((r) => ({ key: r, label: t(`reviews.reportReason.${r}`), selected: reason === r, testID: `Review-report-reason-${r}` }))}
      onSelect={(key) => setReason(key as ReviewReportReason)}
      onClose={onClose}
    >
      <Input
        label={t('reviews.reportSheet.details')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={500}
        testID="Review-report-details"
      />
      <Button title={t('reviews.reportSheet.send')} onPress={submit} loading={send.isPending} phLabel="Review-report-send" />
    </ActionSheet>
  );
}

/** Reply once to a published review (§10.5), ≤ 300, public. */
export function ReplySheet({ review, onClose, onDone }: { review: PublicReview | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [key, setKey] = useState(newInstallId);
  const send = useMutation({ mutationFn: (v: { id: string; text: string; key: string }) => replyToReview(v.id, v.text, v.key) });

  useEffect(() => {
    setText('');
    setError(undefined);
    setKey(newInstallId());
  }, [review?.id]);

  const submit = () => {
    if (!review) return;
    const problem = replyProblem(text);
    if (problem) {
      setError(problem === 'empty' ? t('reviews.replySheet.empty') : t('reviews.replySheet.tooLong', { max: DEAL_LIMITS.replyMax }));
      return;
    }
    // The same key on a retry of this reply (a lost response replays, never posts twice).
    send.mutate({ id: review.id, text: text.trim(), key }, {
      onSuccess: () => {
        track(REVIEW_EVENTS.reviewReplied);
        onDone();
        Toast.show({ type: 'success', text1: t('reviews.replySheet.sent') });
      },
      onError: (err) => setError(f6ErrorMessage(err)),
    });
  };

  return (
    <ActionSheet
      visible={review !== null}
      title={t('reviews.replySheet.title')}
      subtitle={t('reviews.replySheet.hint')}
      items={[]}
      onSelect={() => {}}
      onClose={onClose}
    >
      <Input
        label={t('reviews.replySheet.label')}
        value={text}
        onChangeText={(v) => { setText(v); setError(undefined); }}
        multiline
        maxLength={DEAL_LIMITS.replyMax + 50}
        error={error}
        testID="Review-reply-input"
      />
      <Button title={t('reviews.replySheet.send')} onPress={submit} loading={send.isPending} phLabel="Review-reply-send" />
    </ActionSheet>
  );
}
