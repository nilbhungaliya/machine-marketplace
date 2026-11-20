import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartRequestReplyItem } from '@mpm/shared-types';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { ShieldAlert, ShieldCheck, Star } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import ListingCardItem from '@/screens/listing/listing-card-item';

/**
 * A seller's reply on the buyer's requirement (F8 spec §13.1, mockup "Replies and matches" `.reply`): the seller's name,
 * verified badge and rating, the listing card (opens the listing page), the masked message (with chat's scam warning
 * when flagged), "New" until the buyer opened the page, and "No longer available" when the listing left the market.
 */
export default function ReplyCard({ item, onOpen, style }: { item: PartRequestReplyItem; onOpen: () => void; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    box: {
      backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline,
      paddingVertical: spacing.md, gap: spacing.sm,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, flexWrap: 'wrap' },
    seller: { ...type('bodyStrong'), color: colors.text, flexShrink: 1 },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    ratingText: { ...type('caption'), color: colors.textSecondary },
    card: { marginHorizontal: spacing.sm },
    message: { ...type('body'), color: colors.textSecondary, paddingHorizontal: spacing.md },
    warn: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingHorizontal: spacing.md },
    warnText: { ...type('caption'), color: colors.warn, flex: 1 },
  }), [colors, type]);

  const score = item.seller.score;
  return (
    <View style={[s.box, style]}>
      <View style={s.head}>
        <Text style={s.seller} numberOfLines={1}>{item.seller.name}</Text>
        {item.seller.verified ? <StatusChip tone="ok" icon={ShieldCheck} label={t('requirements.reply.verified')} /> : null}
        {score ? (
          <View style={s.rating}>
            <Star size={13} color={colors.star} />
            <Text style={s.ratingText}>{t('requirements.reply.rating', { stars: score.stars.toFixed(1), count: score.count })}</Text>
          </View>
        ) : (
          <Text style={s.ratingText}>{t('requirements.reply.newSeller')}</Text>
        )}
        {!item.viewed ? <StatusChip tone="new" label={t('requirements.reply.new')} /> : null}
        {!item.live ? <StatusChip tone="neutral" label={t('requirements.reply.notLive')} /> : null}
      </View>
      <ListingCardItem card={item.card} onPress={onOpen} testID="Requirement-reply-card" style={s.card} />
      {item.message ? <Text style={s.message}>{t('requirements.reply.quote', { message: item.message })}</Text> : null}
      {item.messageFlagged ? (
        <View style={s.warn}>
          <ShieldAlert size={16} color={colors.warn} />
          <Text style={s.warnText}>{t('requirements.reply.scamWarning')}</Text>
        </View>
      ) : null}
    </View>
  );
}
