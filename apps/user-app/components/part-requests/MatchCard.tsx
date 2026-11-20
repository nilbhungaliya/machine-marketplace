import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartRequestMatchItem } from '@mpm/shared-types';
import ListingCardItem from '@/screens/listing/listing-card-item';

/**
 * An auto match on the buyer's requirement (F8 spec §7.4, §13.1 "Auto matches"): the listing card with why it matched
 * (same part number, name and fit, similar name, fits your machine) and "New" until the buyer opened the page. Opens
 * the listing page.
 */
export default function MatchCard({ item, onOpen, style }: { item: PartRequestMatchItem; onOpen: () => void; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const why = t(`requirements.match.tier.${item.tier}`);
  return (
    <ListingCardItem
      card={item.card}
      onPress={onOpen}
      tag={item.seen ? why : t('requirements.match.newTag', { why })}
      testID="Requirement-match-card"
      style={style}
    />
  );
}
