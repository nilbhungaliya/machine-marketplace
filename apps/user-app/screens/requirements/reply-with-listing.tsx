import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { PART_REQUEST_LIMITS } from '@mpm/shared-types';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { usePartRequest } from '@/hooks/use-part-request';
import { useCreateReplyListing, useReplyOptions, useSendReplies } from '@/hooks/use-seller-part-requests';
import { useType } from '@/hooks/use-type';
import { errorCode, errorDetails } from '@/lib/api-error';
import { f8ErrorMessage } from '@/lib/f8-errors';
import { ClipboardList, Info, Tag, TriangleAlert } from '@/lib/icons';
import {
  keepFitting, pickerRows, rejectedListingIds, replyInvalidKey, selectionCap, sellerActions, toggleSelection,
} from '@/lib/reply-picker';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from '../listing/listing-card-item';

/**
 * Reply with my listing (F8 spec §9.2, §9.3, §13.1; R2): the seller's live listings of the request's kind, fitting
 * ones first and the others greyed with their reason; pick up to the slots left (≤ 3), an optional message (≤ 300,
 * masked for the buyer by the API), Send (`Idempotency-Key`). **Create a new listing** makes a prefilled draft with a
 * pending reply (`POST /listings { kind, partRequestId }`) and opens the sell wizard on it: the reply goes when the
 * listing is live. Only when the API's seller view says `canReply` (a viewer, a closed request or no slots left read
 * a notice instead).
 */
export default function ReplyWithListingScreen({ navigation, route }: RootStackScreenProps<'ReplyWithListing'>) {
  const { partRequestId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const request = usePartRequest(partRequestId);
  const seller = request.data?.role === 'seller' ? request.data : null;
  const canReply = !!seller?.canReply;
  const options = useReplyOptions(partRequestId);
  const send = useSendReplies(partRequestId);
  const create = useCreateReplyListing(partRequestId);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
    lead: { ...type('lead'), color: colors.textSecondary },
    name: { ...type('cardTitle'), color: colors.text },
    section: { ...type('section'), color: colors.text, marginTop: spacing.sm },
    greyed: { opacity: 0.55 },
    skeleton: { height: 112, borderRadius: radius.xl },
    count: { ...type('caption'), color: colors.textMuted, textAlign: 'right' },
  }), [colors, type]);

  const list = options.data?.listings ?? [];
  const slotsLeft = options.data?.slotsLeft ?? 0;
  const dailyLeft = options.data?.dailyLeft ?? 0;
  const cap = selectionCap(slotsLeft, dailyLeft);
  const rows = pickerRows(list, cap, selected);
  const fittingCount = rows.filter((r) => r.reasonKey === null).length;
  const messageLength = message.trim().length;
  const messageTooLong = messageLength > PART_REQUEST_LIMITS.messageMax;

  const refetchOptions = () => {
    void options.refetch().then((r) => { if (r.data) setSelected((cur) => keepFitting(cur, r.data.listings)); });
  };

  const onSend = () => {
    if (selected.length === 0 || messageTooLong) return;
    send.mutate(
      { listingIds: selected, message: message.trim() || null },
      {
        onSuccess: () => {
          Toast.show({ type: 'success', text1: t('buyers.reply.sent', { count: selected.length }) });
          navigation.goBack();
        },
        onError: (err) => {
          const code = errorCode(err);
          if (code === 'REPLY_LISTING_INVALID' || code === 'REPLY_EXISTS') {
            const details = errorDetails(err);
            const drop = new Set(rejectedListingIds(details));
            setSelected((cur) => cur.filter((id) => !drop.has(id)));
            Toast.show({ type: 'error', text1: code === 'REPLY_EXISTS' ? f8ErrorMessage(err) : t(replyInvalidKey(details)) });
            refetchOptions();
            return;
          }
          Toast.show({ type: 'error', text1: f8ErrorMessage(err) });
          if (code === 'REPLY_LIMIT' || code === 'REPLY_DAILY_LIMIT') refetchOptions();
        },
      },
    );
  };

  const onCreate = () => {
    if (!seller) return;
    create.mutate(seller.kind, {
      onSuccess: (listing) => navigation.replace('Sell', { listingId: listing.id, step: 'category', mode: 'create' }),
      onError: (err) => {
        const code = errorCode(err);
        Toast.show({
          type: 'error',
          text1: code === 'REPLY_LISTING_INVALID' ? t(replyInvalidKey(errorDetails(err))) : f8ErrorMessage(err),
        });
      },
    });
  };

  let body: React.ReactNode;
  if (request.isLoading || (canReply && options.isLoading)) {
    body = (
      <View style={s.content}>
        <Skeleton style={s.skeleton} />
        <Skeleton style={s.skeleton} />
        <Skeleton style={s.skeleton} />
      </View>
    );
  } else if (request.isError || options.isError || !seller) {
    // The buyer's own request answers `role: 'buyer'` here and `409 OWN_PART_REQUEST` from the picker.
    const own = request.data?.role === 'buyer' || errorCode(options.error) === 'OWN_PART_REQUEST';
    const gone = errorCode(request.error) === 'PART_REQUEST_NOT_FOUND' || errorCode(options.error) === 'PART_REQUEST_NOT_FOUND';
    body = own ? (
      <EmptyState icon={ClipboardList} title={t('errors.requests.ownPartRequest')} subtitle={t('buyers.reply.ownBody')} />
    ) : gone ? (
      <EmptyState icon={ClipboardList} title={t('requirements.goneTitle')} subtitle={t('requirements.goneBody')} />
    ) : (
      <EmptyState
        icon={TriangleAlert}
        title={t('buyers.reply.loadErrorTitle')}
        subtitle={t('buyers.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="ReplyWithListing-retry"
        onCtaPress={() => { void request.refetch(); void options.refetch(); }}
      />
    );
  } else if (!canReply) {
    const key = sellerActions(seller).replyBlockedKey ?? 'buyers.request.replyBlocked.closed';
    body = (
      <View style={s.content}>
        <Text style={s.name}>{seller.name}</Text>
        <Notice tone="info" icon={Info} text={t(key)} />
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.name}>{seller.name}</Text>
        <Text style={s.lead}>{t('buyers.reply.lead', { count: cap })}</Text>
        {dailyLeft === 0 ? <Notice tone="warning" icon={Info} text={t('buyers.reply.dailyUsed')} /> : null}

        {list.length === 0 ? (
          <Notice tone="info" icon={Info} title={t('buyers.reply.noListingsTitle')} text={t(`buyers.reply.noListings.${seller.kind}`)} />
        ) : (
          <>
            {fittingCount === 0 ? <Notice tone="info" icon={Info} text={t('buyers.reply.noneFit')} /> : null}
            {rows.map((row) => (
              <ListingCardItem
                key={row.listingId}
                card={row.option.card}
                save={false}
                onPress={() => {
                  if (row.reasonKey !== null) return;
                  setSelected((cur) => toggleSelection(cur, row.listingId, list, cap));
                }}
                status={row.selected ? { label: t('buyers.reply.selected'), tone: 'new' } : null}
                nudge={row.reasonKey ? t(row.reasonKey) : row.disabled ? t('buyers.reply.full') : undefined}
                style={row.reasonKey !== null || row.disabled ? s.greyed : undefined}
                testID={`ReplyWithListing-option-${row.listingId}`}
              />
            ))}
          </>
        )}

        <Input
          label={t('buyers.reply.message')}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={PART_REQUEST_LIMITS.messageMax + 20}
          placeholder={t('buyers.reply.messageHint')}
          error={messageTooLong ? t('buyers.reply.messageTooLong', { max: PART_REQUEST_LIMITS.messageMax }) : undefined}
          testID="ReplyWithListing-message"
        />
        <Text style={s.count}>{t('buyers.reply.messageCount', { n: messageLength, max: PART_REQUEST_LIMITS.messageMax })}</Text>

        <Text style={s.section}>{t('buyers.reply.newTitle')}</Text>
        <Text style={s.lead}>{t('buyers.reply.newBody')}</Text>
        <Button
          title={t('buyers.reply.create')}
          variant="outline"
          icon={Tag}
          loading={create.isPending}
          disabled={slotsLeft === 0 || dailyLeft === 0}
          onPress={onCreate}
          phLabel="ReplyWithListing-create"
        />
      </ScrollView>
    );
  }

  return (
    <ScreenWrapper keyboardAware>
      <View style={s.root} testID="ReplyWithListing-screen">
        <Header title={t('buyers.reply.title')} />
        {body}
        {seller && canReply && list.length > 0 ? (
          <FooterBar>
            <Button
              title={selected.length > 0 ? t('buyers.reply.sendCount', { count: selected.length }) : t('buyers.reply.send')}
              size="md"
              disabled={selected.length === 0 || messageTooLong || dailyLeft === 0}
              loading={send.isPending}
              onPress={onSend}
              phLabel="ReplyWithListing-send"
            />
          </FooterBar>
        ) : null}
      </View>
    </ScreenWrapper>
  );
}
