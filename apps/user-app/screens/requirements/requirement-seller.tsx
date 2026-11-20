import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { PartRequestSellerView, SellerReplyView } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { useConfirm } from '@/components/ConfirmSheet';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import IconButton from '@/components/IconButton';
import Notice from '@/components/Notice';
import SideToken from '@/components/SideToken';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import BuyerBlock from '@/components/part-requests/BuyerBlock';
import NotRelevantSheet from '@/components/part-requests/NotRelevantSheet';
import RequestReportSheet from '@/components/part-requests/RequestReportSheet';
import {
  budgetText, conditionsText, neededByText, placeLine, requestSideKind,
} from '@/components/part-requests/SellerRequestRow';
import { useMasterData } from '@/hooks/use-listing';
import { useNotRelevant, useRequestPhotos, useWithdrawReply } from '@/hooks/use-seller-part-requests';
import { useType } from '@/hooks/use-type';
import { f8ErrorMessage } from '@/lib/f8-errors';
import { Ban, Flag, Images, Info, Send, ShieldAlert, X } from '@/lib/icons';
import { quantityText, refText, yearRange } from '@/lib/listing-format';
import { daysLeftKey, requestStatusKey, requestStatusTone, sideAcceptKeys } from '@/lib/part-request-display';
import { canWithdraw, replyStatusLine, sellerActions } from '@/lib/reply-picker';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

export interface RequirementSellerProps {
  request: PartRequestSellerView;
  /** The tab a notification asked for (`replies` / `matches`); the buyer view only. */
  tab?: 'replies' | 'matches';
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PHOTO_SIZE = 96;
/** A signed URL that fails (expired after 300 s) refetches the photos at most this often (as chat and deals do). */
const PHOTO_REFRESH_GAP_MS = 10_000;

/**
 * A requirement as an eligible seller sees it (F8 spec §12.3, §13.1; mockup requirements · "Seller sees a
 * requirement"): the request card (wanted side, quantity, fits, conditions, budget or "Private", needed by, place and
 * km, days left), the masked note with the scam warning, reference photos (300 s signed URLs, fetched on tap), the
 * buyer block, this business's replies with their status and Withdraw, **Reply with my listing**, **Not relevant**
 * (Undo when set) and Report. No "Send a quote" (P2). A viewer member reads only (`sellerActions`).
 */
export default function RequirementSeller({ request }: RequirementSellerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<Nav>();
  const confirm = useConfirm();
  const master = useMasterData();
  const withdraw = useWithdrawReply(request.id);
  const { undo } = useNotRelevant(request.id);
  const [notRelevantOpen, setNotRelevantOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  // The zoomed photo by index, so a refetch after an expired URL shows the fresh one.
  const [zoom, setZoom] = useState<number | null>(null);
  const photos = useRequestPhotos(request.id, photosOpen && request.photoCount > 0);
  const lastPhotoRefresh = useRef(0);
  const refetchPhotos = photos.refetch;
  const onPhotoExpired = useCallback(() => {
    const now = Date.now();
    if (now - lastPhotoRefresh.current < PHOTO_REFRESH_GAP_MS) return;
    lastPhotoRefresh.current = now;
    void refetchPhotos();
  }, [refetchPhotos]);
  const zoomUrl = zoom !== null ? photos.data?.photos[zoom]?.url ?? null : null;
  const actions = sellerActions(request);
  const active = request.status === 'active';

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
    head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    headBody: { flex: 1, gap: spacing.xs },
    name: { ...type('title'), color: colors.text },
    ref: { ...type('mono'), color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    partNo: { ...type('mono'), color: colors.text },
    facts: { gap: spacing.sm, marginTop: spacing.md },
    fact: { flexDirection: 'row', gap: spacing.md },
    factLabel: { ...type('caption'), color: colors.textMuted, width: 104 },
    factValue: { ...type('body'), color: colors.text, flex: 1 },
    section: { ...type('section'), color: colors.text, marginTop: spacing.sm },
    note: { ...type('body'), color: colors.text },
    caption: { ...type('caption'), color: colors.textSecondary },
    photoRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden' },
    photoImg: { width: '100%', height: '100%' },
    reply: { gap: spacing.xs },
    replyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    replyTitle: { ...type('bodyStrong'), color: colors.text, flex: 1 },
    zoomBox: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center' },
    zoomImg: { width: '100%', height: '80%' },
    zoomClose: { position: 'absolute', top: spacing.xxxl, right: spacing.lg },
  }), [colors, type]);

  const days = daysLeftKey(request.daysLeft);
  const accepts = sideAcceptKeys(request.side).map((k) => t(k)).join(', ');
  const place = [placeLine(request.city, request.distanceKm), request.inReach ? '' : t('buyers.row.outsideReach')]
    .filter(Boolean).join(' · ');
  const fits = request.fits.map((f) => [[f.brandName, f.modelName].filter(Boolean).join(' '), yearRange(f.yearFrom, f.yearTo)]
    .filter(Boolean).join(' · '));
  const sideKind = requestSideKind(request.side);

  const facts: { key: string; label: string; value: string }[] = [
    { key: 'category', label: t('buyers.request.category'), value: request.categoryPath.map((c) => c.name).join(' › ') },
    { key: 'accepts', label: t('buyers.request.accepts'), value: accepts },
    { key: 'quantity', label: t('buyers.request.quantity'), value: quantityText(request.quantity, request.unit) },
    { key: 'fits', label: t(request.kind === 'machine' ? 'buyers.request.makeModel' : 'buyers.request.fits'), value: fits.join('\n') },
    { key: 'condition', label: t('buyers.request.condition'), value: conditionsText(request.conditionIds, master.data?.conditions) },
    { key: 'budget', label: t('buyers.request.budget'), value: budgetText(request.budgetPerUnitPaise) },
    { key: 'needed', label: t('buyers.request.needed'), value: neededByText(request.neededBy) },
    { key: 'place', label: t('buyers.request.place'), value: place },
    { key: 'days', label: t('buyers.request.open'), value: active ? t(days.key, days.count !== undefined ? { count: days.count } : {}) : '' },
  ].filter((f) => f.value !== '');

  const onWithdraw = async (reply: SellerReplyView) => {
    const ok = await confirm({
      title: t('buyers.myReplies.withdrawTitle'),
      message: t('buyers.myReplies.withdrawBody'),
      confirmLabel: t('buyers.myReplies.withdraw'),
      destructive: true,
    });
    if (!ok) return;
    withdraw.mutate(reply.id, {
      onSuccess: () => Toast.show({ type: 'success', text1: t('buyers.myReplies.withdrawDone') }),
      onError: (err) => Toast.show({ type: 'error', text1: f8ErrorMessage(err) }),
    });
  };

  const onUndo = () => undo.mutate(undefined, {
    onSuccess: () => Toast.show({ type: 'success', text1: t('buyers.notRelevant.undone') }),
    onError: (err) => Toast.show({ type: 'error', text1: f8ErrorMessage(err) }),
  });

  return (
    <View style={s.root} testID="RequirementSeller">
      <Header
        title={t('buyers.request.title')}
        rightIcon={actions.report ? (
          <IconButton icon={Flag} onPress={() => setReportOpen(true)} accessibilityLabel={t('buyers.report.title')} testID="RequirementSeller-report" />
        ) : null}
      />
      <ScrollView contentContainerStyle={s.content}>
        {!active ? <Notice tone="warning" icon={Info} text={t('buyers.request.notOpen')} /> : null}
        {request.notRelevant ? (
          <Notice tone="info" icon={Ban} title={t('buyers.notRelevant.hiddenTitle')} text={t('buyers.notRelevant.hiddenBody')}>
            {actions.undoNotRelevant ? (
              <Button title={t('buyers.notRelevant.undo')} size="sm" variant="outline" loading={undo.isPending} onPress={onUndo} phLabel="RequirementSeller-undo-not-relevant" />
            ) : null}
          </Notice>
        ) : null}

        <Card>
          <View style={s.head}>
            {sideKind ? <SideToken kind={sideKind} size="xl" /> : null}
            <View style={s.headBody}>
              <Text style={s.name} accessibilityRole="header">{request.name}</Text>
              <Text style={s.ref}>{refText(request.ref)}</Text>
              {request.partNumber ? <Text style={s.partNo}>{request.partNumber}</Text> : null}
              <View style={s.chips}>
                {!active ? <StatusChip label={t(requestStatusKey(request.status))} tone={requestStatusTone(request.status)} /> : null}
                {request.urgent ? <StatusChip label={t('buyers.row.urgent')} tone="danger" /> : null}
                {request.targeted ? <StatusChip label={t('buyers.row.forYou')} tone="sun" /> : null}
                {request.hasMatchingStock ? <StatusChip label={t('buyers.row.youHaveStock')} tone="ok" /> : null}
              </View>
            </View>
          </View>
          <View style={s.facts}>
            {facts.map((f) => (
              <View key={f.key} style={s.fact}>
                <Text style={s.factLabel}>{f.label}</Text>
                <Text style={s.factValue}>{f.value}</Text>
              </View>
            ))}
          </View>
        </Card>

        {request.note ? (
          <Card>
            <Text style={s.caption}>{t('buyers.request.note')}</Text>
            <Text style={s.note}>{request.note}</Text>
          </Card>
        ) : null}
        {request.noteFlagged ? <Notice tone="warning" icon={ShieldAlert} text={t('buyers.request.scamWarning')} /> : null}

        {request.photoCount > 0 ? (
          <Card>
            <Text style={s.caption}>{t('buyers.request.photos', { count: request.photoCount })}</Text>
            {!photosOpen ? (
              <Button
                title={t('buyers.request.showPhotos')}
                icon={Images}
                size="sm"
                variant="outline"
                onPress={() => setPhotosOpen(true)}
                phLabel="RequirementSeller-photos"
                style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}
              />
            ) : (
              <View style={s.photoRow}>
                {photos.isLoading ? Array.from({ length: request.photoCount }, (_, i) => <Skeleton key={i} style={s.photo} />) : null}
                {photos.isError ? <Text style={s.caption}>{t('buyers.request.photosError')}</Text> : null}
                {(photos.data?.photos ?? []).map((p, i) => (
                  <Pressable
                    key={p.url}
                    style={s.photo}
                    onPress={() => setZoom(i)}
                    testID={`RequirementSeller-photo-${i}`}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={t('buyers.request.photoA11y', { n: i + 1 })}
                  >
                    <Image source={{ uri: p.url }} style={s.photoImg} contentFit="cover" cachePolicy="memory" onError={onPhotoExpired} accessibilityIgnoresInvertColors />
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        ) : null}

        <Card>
          <BuyerBlock buyer={request.buyer} />
          <Text style={[s.caption, { marginTop: spacing.sm }]}>
            {request.replyCount > 0 ? t('buyers.row.replies', { count: request.replyCount }) : t('buyers.row.noReplies')}
          </Text>
        </Card>

        {request.myReplies.length > 0 ? (
          <>
            <Text style={s.section}>{t('buyers.myReplies.title')}</Text>
            {request.myReplies.map((reply) => {
              const line = replyStatusLine(reply);
              return (
                <Card key={reply.id} style={s.reply}>
                  <View style={s.replyTop}>
                    <Text style={s.replyTitle} numberOfLines={2}>{reply.listingTitle}</Text>
                    <StatusChip label={t(`buyers.myReplies.chip.${reply.status}`)} tone={line.tone} />
                  </View>
                  <Text style={s.caption}>{t(line.key)}</Text>
                  {reply.message ? <Text style={s.note}>{reply.message}</Text> : null}
                  {canWithdraw(reply) && actions.withdraw ? (
                    <Button
                      title={t('buyers.myReplies.withdraw')}
                      size="sm"
                      variant="outline"
                      loading={withdraw.isPending && withdraw.variables === reply.id}
                      onPress={() => void onWithdraw(reply)}
                      phLabel={`RequirementSeller-withdraw-${reply.id}`}
                      style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}
                    />
                  ) : null}
                  <Button
                    title={t('buyers.myReplies.openListing')}
                    size="sm"
                    variant="ghost"
                    onPress={() => navigation.navigate('Listing', { listingId: reply.listingId })}
                    phLabel={`RequirementSeller-listing-${reply.id}`}
                    style={{ alignSelf: 'flex-start' }}
                  />
                </Card>
              );
            })}
          </>
        ) : null}

        {active && actions.replyBlockedKey ? (
          <Notice tone="info" icon={Info} text={t(actions.replyBlockedKey)} />
        ) : null}
      </ScrollView>

      {actions.reply || actions.notRelevant ? (
        <FooterBar>
          {actions.notRelevant ? (
            <Button
              title={t('buyers.notRelevant.action')}
              size="md"
              variant="outline"
              onPress={() => setNotRelevantOpen(true)}
              phLabel="RequirementSeller-not-relevant"
            />
          ) : null}
          {actions.reply ? (
            <Button
              title={t('buyers.request.reply')}
              size="md"
              icon={Send}
              onPress={() => navigation.navigate('ReplyWithListing', { partRequestId: request.id })}
              phLabel="RequirementSeller-reply"
            />
          ) : null}
        </FooterBar>
      ) : null}

      <NotRelevantSheet
        visible={notRelevantOpen}
        partRequestId={request.id}
        requestName={request.name}
        onClose={() => setNotRelevantOpen(false)}
      />
      <RequestReportSheet
        visible={reportOpen}
        partRequestId={request.id}
        requestName={request.name}
        onClose={() => setReportOpen(false)}
      />
      <Modal visible={zoom !== null} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <View style={s.zoomBox}>
          {zoomUrl ? <Image source={{ uri: zoomUrl }} style={s.zoomImg} contentFit="contain" cachePolicy="memory" onError={onPhotoExpired} accessibilityIgnoresInvertColors /> : null}
          <IconButton icon={X} onPress={() => setZoom(null)} accessibilityLabel={t('buyers.request.closePhoto')} testID="RequirementSeller-photo-close" style={s.zoomClose} />
        </View>
      </Modal>
    </View>
  );
}
