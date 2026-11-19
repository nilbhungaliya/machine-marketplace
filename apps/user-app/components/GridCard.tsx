import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { ListingCard } from '@mpm/shared-types';
import SaveButton from '@/components/SaveButton';
import SideToken from '@/components/SideToken';
import { useHeartViewer } from '@/hooks/use-saved';
import { useType } from '@/hooks/use-type';
import { Package, Tag } from '@/lib/icons';
import { priceText, sideTokenKind } from '@/lib/listing-format';
import { canShowHeart } from '@/lib/saved-cache';
import { cardTagKeys } from '@/lib/side-tags';
import { radius, spacing, useTheme } from '@/lib/theme';

interface GridCardProps {
  card: ListingCard;
  onPress: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A grid card (v2 `.gcard`, F4 + F5 spec §8.6): product shot with the heart (top right), the side token for a part (top
 * left) and the first tag as the yellow badge (bottom), then the title and the price. Home's "Top items near you" and
 * rentals-only results. Hairline border, no shadow (cards don't cast shadows).
 */
export default function GridCard({ card, onPress, testID, style }: GridCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const viewer = useHeartViewer();
  const side = card.kind === 'part' ? sideTokenKind(card.side) : 'none';
  const badge = cardTagKeys(card.tags)[0];
  const price = priceText(card);

  const s = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline,
      padding: 5, paddingBottom: spacing.md, gap: spacing.sm, alignItems: 'center',
    },
    photo: {
      width: '100%', aspectRatio: 1.08, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    heart: { position: 'absolute', right: 6, top: 6 },
    side: { position: 'absolute', left: 6, top: 6 },
    badge: {
      ...type('badge'), position: 'absolute', bottom: 6, alignSelf: 'center', maxWidth: '92%', color: colors.onSun,
      backgroundColor: colors.sun, borderRadius: radius.full, paddingHorizontal: spacing.sm, overflow: 'hidden',
    },
    title: { ...type('cardTitle'), color: colors.text, textAlign: 'center', paddingHorizontal: spacing.xs },
    price: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
    priceText: { ...type('chip'), color: colors.text, fontVariant: ['tabular-nums'] },
  }), [colors, type]);

  return (
    <Pressable style={[s.card, style]} onPress={onPress} testID={testID} accessibilityRole="button">
      <View style={s.photo}>
        {card.thumbUrl ? (
          <Image source={{ uri: card.thumbUrl }} style={s.image} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Package size={36} color={colors.textMuted} />
        )}
        {side !== 'none' ? <SideToken kind={side} style={s.side} /> : null}
        {badge ? <Text style={s.badge} numberOfLines={1}>{t(badge)}</Text> : null}
        {canShowHeart(card, viewer) ? (
          <SaveButton listingId={card.id} saved={card.saved} testID={`${testID}-save`} style={s.heart} />
        ) : null}
      </View>
      <Text style={s.title} numberOfLines={2}>{card.title}</Text>
      {price ? (
        <View style={s.price}>
          <Tag size={13} color={colors.textMuted} />
          <Text style={s.priceText} numberOfLines={1}>{price}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
