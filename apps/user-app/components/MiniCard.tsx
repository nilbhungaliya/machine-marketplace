import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { ListingCard } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { Package } from '@/lib/icons';
import { priceText } from '@/lib/listing-format';
import { cardTagKeys } from '@/lib/side-tags';
import { radius, spacing, useTheme } from '@/lib/theme';

interface MiniCardProps {
  card: ListingCard;
  onPress: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** Card width (v2 `.mini` 132 × the app's 1.15 scale). */
export const MINI_CARD_WIDTH = 152;

/**
 * A small card for a horizontal row (v2 `.mini`, F4 + F5 spec §8.6): photo, title, price (a rental's headline rate).
 * Home's "Machines for rent nearby". A rented machine carries its "On rent" tag under the price.
 */
export default function MiniCard({ card, onPress, testID, style }: MiniCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const tag = cardTagKeys(card.tags)[0];
  const price = priceText(card);

  const s = useMemo(() => StyleSheet.create({
    card: {
      width: MINI_CARD_WIDTH, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.hairline, padding: 5, paddingBottom: spacing.sm + 2, gap: spacing.xs,
    },
    photo: {
      width: '100%', height: 90, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    title: { ...type('label'), color: colors.text, paddingHorizontal: spacing.xs },
    price: { ...type('chip'), color: colors.text, paddingHorizontal: spacing.xs, fontVariant: ['tabular-nums'] },
    tag: {
      ...type('badge'), alignSelf: 'flex-start', marginHorizontal: spacing.xs, color: colors.onSun, backgroundColor: colors.sun,
      borderRadius: radius.full, paddingHorizontal: spacing.sm, overflow: 'hidden',
    },
  }), [colors, type]);

  return (
    <Pressable style={[s.card, style]} onPress={onPress} testID={testID} accessibilityRole="button">
      <View style={s.photo}>
        {card.thumbUrl ? (
          <Image source={{ uri: card.thumbUrl }} style={s.image} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Package size={28} color={colors.textMuted} />
        )}
      </View>
      <Text style={s.title} numberOfLines={2}>{card.title}</Text>
      {price ? <Text style={s.price} numberOfLines={1}>{price}</Text> : null}
      {tag ? <Text style={s.tag} numberOfLines={1}>{t(tag)}</Text> : null}
    </Pressable>
  );
}
