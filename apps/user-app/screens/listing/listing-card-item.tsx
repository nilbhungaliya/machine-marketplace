import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ListingCard as ListingCardData } from '@mpm/shared-types';
import ListingCard from '@/components/ListingCard';
import PriceText from '@/components/PriceText';
import type { StatusTone } from '@/components/StatusChip';
import { conditionLabel, distanceText, placeText, quantityText, sideTokenKind, unitPer } from '@/lib/listing-format';

interface ListingCardItemProps {
  card: ListingCardData;
  onPress?: () => void;
  testID: string;
  /** Replaces the place and distance line (My listings: "Updated 3 days ago"). */
  subtitle?: string;
  status?: { label: string; tone: StatusTone } | null;
  tag?: string;
  nudge?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A `ListingCard` payload drawn with the shared `ListingCard` (F2 spec §15.2): side, condition, quantity, the price pill
 * (a rental's headline rate, "Price on request", or the price per unit) and the place with the distance. Used by More
 * from this seller, the seller's listings, Other side and My listings.
 */
export default function ListingCardItem({ card, onPress, testID, subtitle, status, tag, nudge, children, style }: ListingCardItemProps) {
  const { t } = useTranslation();

  let price: React.ReactNode = null;
  if (card.kind === 'machine_rental') {
    if (card.rate) price = <PriceText size="pill" paise={card.rate.paise} suffix={t(`listing.period.${card.rate.period}`)} />;
  } else if (card.priceModel === 'on_request') {
    price = <PriceText size="pill" paise={null} fallback={t('listing.price.onRequest')} />;
  } else if (card.pricePaise != null) {
    price = <PriceText size="pill" paise={card.pricePaise} suffix={card.kind === 'part' ? unitPer(card.unit) : undefined} />;
  }

  const place = [placeText(card), distanceText(card.distanceKm)].filter(Boolean).join(' · ');

  return (
    <ListingCard
      title={card.title}
      thumbUrl={card.thumbUrl}
      side={card.kind === 'part' ? sideTokenKind(card.side) : null}
      condition={card.kind === 'machine_rental' ? undefined : conditionLabel(card.condition) || undefined}
      quantity={quantityText(card.quantity, card.unit) || undefined}
      price={price}
      subtitle={subtitle ?? (place || undefined)}
      subtitleIsPlace={subtitle === undefined}
      status={status}
      tag={tag}
      nudge={nudge}
      onPress={onPress}
      testID={testID}
      style={style}
    >
      {children}
    </ListingCard>
  );
}
