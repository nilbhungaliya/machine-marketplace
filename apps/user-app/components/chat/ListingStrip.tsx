import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { ThreadListingStrip } from '@mpm/shared-types';
import PriceText from '@/components/PriceText';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { formatQuantity } from '@/lib/quantity';
import { ChevronRight, Info, Package } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface ListingStripProps {
  strip: ThreadListingStrip;
  /** Machine listings: the "never pay before inspecting a used machine" tip (§6.7, M19). */
  machineTip: boolean;
  /** Opens the listing; omitted when it isn't public any more. */
  onOpen?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The listing the thread is about, under the app bar (§15.1): thumb, title (the deal's snapshot when there is one, masked
 * by the server), price, available quantity ("2 of 3 pcs available", or "All on hold in deals"), and "No longer listed"
 * when it isn't public. Machine listings carry the inspection tip.
 */
export default function ListingStrip({ strip, machineTip, onOpen, style }: ListingStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    wrap: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
    strip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.xs + 2, paddingRight: spacing.md,
      borderRadius: radius.lg + 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, minHeight: 60,
    },
    thumb: {
      width: 48, height: 48, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.photo,
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    body: { flex: 1, minWidth: 0, gap: 2 },
    title: { ...type('bodyStrong'), color: colors.text },
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    sub: { ...type('caption'), color: colors.textSecondary },
    tip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
    tipText: { ...type('caption'), color: colors.textSecondary, flexShrink: 1 },
  }), [colors, type]);

  const unit = strip.unit?.label ?? '';
  const onHold = strip.availableQuantity !== null && Number(strip.availableQuantity) === 0;
  let availability: string | null = null;
  if (!strip.noLongerListed && strip.availableQuantity !== null && strip.quantity !== null) {
    availability = onHold
      ? t('chats.thread.allOnHold')
      : t('chats.thread.available', { available: formatQuantity(strip.availableQuantity), quantity: formatQuantity(strip.quantity), unit });
  }

  return (
    <View style={[s.wrap, style]}>
      <Pressable
        style={s.strip}
        onPress={onOpen}
        disabled={!onOpen}
        testID="Thread-listing-strip"
        accessibilityRole="button"
        accessibilityLabel={t('chats.thread.openListing')}
      >
        <View style={s.thumb}>
          {strip.thumbUrl ? (
            <Image source={{ uri: strip.thumbUrl }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <Package size={22} color={colors.textMuted} />
          )}
        </View>
        <View style={s.body}>
          <Text style={s.title} numberOfLines={1}>{strip.title}</Text>
          <View style={s.meta}>
            {strip.noLongerListed ? (
              <StatusChip label={t('chats.thread.noLongerListed')} tone="neutral" />
            ) : strip.priceModel === 'on_request' || strip.pricePaise === null ? (
              <Text style={s.sub}>{t('chats.thread.priceOnRequest')}</Text>
            ) : (
              <PriceText paise={strip.pricePaise} suffix={unit ? t('chats.thread.perUnit', { unit }) : undefined} size="pill" />
            )}
            {availability ? <Text style={s.sub} numberOfLines={1}>{availability}</Text> : null}
          </View>
        </View>
        {onOpen ? <ChevronRight size={18} color={colors.textMuted} /> : null}
      </Pressable>
      {machineTip ? (
        <View style={s.tip}>
          <Info size={14} color={colors.warn} />
          <Text style={s.tipText}>{t('chats.thread.machineTip')}</Text>
        </View>
      ) : null}
    </View>
  );
}
