import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import type { ListingFlag, ListingOwnerView } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import Notice from '@/components/Notice';
import ScreenWrapper from '@/components/ScreenWrapper';
import { useConfirm } from '@/components/ConfirmSheet';
import { useListingTemplate, useMasterData } from '@/hooks/use-listing';
import { usePublishListing } from '@/hooks/use-sell-draft';
import { useType } from '@/hooks/use-type';
import { errorCode } from '@/lib/api-error';
import { Check, Info, ShieldCheck, TriangleAlert } from '@/lib/icons';
import { incompleteProblems, listingErrorMessage, needsGstVerification } from '@/lib/listing-errors';
import { priceText, quantityText, unitLabel } from '@/lib/listing-format';
import { videoUploadEnabled } from '@/lib/media-prepare';
import { previewFlags } from '@/lib/sell-form';
import { stepForProblem } from '@/lib/sell-wizard';
import { spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';
import ListingView from '../listing/listing-view';
import type { StepProps } from './step-frame';
import { useOpenGst } from './use-open-gst';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The sanity warning for a flag (§5.4): "Is ₹4 /pc right?". Also the edit-mode Save's check (`sell-step.tsx`). */
export function flagText(t: (k: string, o?: Record<string, unknown>) => string, flag: ListingFlag, l: ListingOwnerView): string {
  switch (flag) {
    case 'price_check': return t('sell.preview.priceCheck', { price: priceText(l) });
    case 'unit_check': return t('sell.preview.unitCheck', { unit: unitLabel(l.unit) });
    case 'quantity_check': return t('sell.preview.quantityCheck', { quantity: quantityText(l.quantity, l.unit) });
  }
}

/**
 * Preview (F2 spec §5.4, §5.5): the listing as buyers will see it (`ListingView` from the owner view), the listing
 * score with its nudges, the sanity warnings the seller confirms, then Publish. `LISTING_INCOMPLETE` opens the step of
 * the first problem; `UNVERIFIED_LISTING_CAP` and `RENTAL_NEEDS_GST` offer the GST flow.
 */
export default function Preview({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<Nav>();
  const confirm = useConfirm();
  const { listing } = ctx;
  // The template with retired fields (`includeRetired=1`): a retired field's stored value shows here as on the listing page.
  const template = useListingTemplate(listing);
  const master = useMasterData();
  const publish = usePublishListing(listing.kind);
  const [gstBlock, setGstBlock] = useState<string | null>(null);
  const gst = useOpenGst();

  const flags = useMemo(() => previewFlags(listing, master.data?.units ?? []), [listing, master.data]);
  const warnings = flags.map((f) => flagText(t, f, listing));
  // No "Add a video" nudge while video uploads are off (F2 integration: video off until the device check).
  const { score } = listing.score;
  const missing = listing.score.missing.filter((m) => m !== 'video' || videoUploadEnabled());

  const s = useMemo(() => StyleSheet.create({
    view: { flex: 1 },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
    scoreRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    scoreTitle: { ...type('cardTitle'), color: colors.text },
    score: { ...type('price'), color: colors.primaryInk },
    nudge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    nudgeText: { ...type('body'), color: colors.textSecondary, flex: 1 },
  }), [colors, type]);

  const onPublish = async () => {
    if (warnings.length > 0) {
      const ok = await confirm({
        title: warnings[0]!,
        message: [...warnings.slice(1), t('sell.preview.flagsMessage')].join('\n'),
        confirmLabel: t('sell.preview.publishAnyway'),
        cancelLabel: t('sell.preview.fixIt'),
      });
      if (!ok) return;
    }
    try {
      const res = await publish.mutateAsync(listing.id);
      // The wizard is done: Back from Published goes to the Post tab, not into the steps.
      const stack = [
        { screen: 'Main', params: { screen: 'Post' } },
        { screen: 'SellPublished', params: { listingId: listing.id, outcome: res.outcome } },
      ];
      navigation.reset({ index: 1, routes: stack.map((r) => ({ name: r.screen, params: r.params })) as never });
    } catch (err) {
      const problems = incompleteProblems(err);
      const target = problems.map((p) => stepForProblem(p.field, listing.kind)).find((st) => st !== null);
      if (target) {
        Toast.show({ type: 'info', text1: t('sell.preview.finishStep', { step: t(`sell.steps.${target}`) }) });
        // Edit mode: Save comes back to this Preview instead of walking the remaining steps again.
        navigation.push('Sell', { listingId: listing.id, step: target, mode: 'edit' });
        return;
      }
      if (needsGstVerification(err)) {
        setGstBlock(listingErrorMessage(err));
        return;
      }
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
      if (errorCode(err) === 'LISTING_TRANSITION_NOT_ALLOWED') navigation.goBack();
    }
  };

  const header = (
    <View style={s.header}>
      <Notice tone="info" icon={Info} text={t('sell.preview.note')} />
      {gstBlock ? (
        <Notice tone="warning" icon={ShieldCheck} title={gstBlock} text={t('sell.preview.gstHelp')}>
          <Button title={t('sell.verifyGst')} phLabel="Sell-preview-verify-gst" size="sm" loading={gst.opening} onPress={() => void gst.open()} />
        </Notice>
      ) : null}
      {warnings.map((w) => <Notice key={w} tone="warning" icon={TriangleAlert} title={w} text={t('sell.preview.flagsMessage')} />)}
      <Card>
        <View style={s.scoreRow}>
          <Text style={s.scoreTitle}>{t('sell.preview.score')}</Text>
          <Text style={s.score}>{t('sell.preview.scoreValue', { score })}</Text>
        </View>
        {missing.length === 0 ? (
          <View style={s.nudge}><Check size={16} color={colors.ok} /><Text style={s.nudgeText}>{t('sell.preview.scoreFull')}</Text></View>
        ) : missing.map((m) => (
          <View key={m} style={s.nudge}>
            <Info size={16} color={colors.warn} />
            <Text style={s.nudgeText}>{t(`listing.score.${m}`)}</Text>
          </View>
        ))}
      </Card>
    </View>
  );

  return (
    <ScreenWrapper>
      <Header title={t('sell.steps.preview')} />
      <ListingView listing={listing} template={template.data ?? null} header={header} bottomInset={spacing.lg} style={s.view} testID="Sell-preview" />
      <FooterBar>
        <Button
          title={listing.status === 'rejected' ? t('sell.preview.resubmit') : t('sell.preview.publish')}
          phLabel="Sell-publish"
          size="md"
          loading={publish.isPending}
          onPress={() => void onPublish()}
        />
      </FooterBar>
    </ScreenWrapper>
  );
}
