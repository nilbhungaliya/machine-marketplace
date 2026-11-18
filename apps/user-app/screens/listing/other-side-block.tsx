import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OtherSideCard, OtherSideResult, PartSide } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import SideToken from '@/components/SideToken';
import Skeleton from '@/components/Skeleton';
import { useType } from '@/hooks/use-type';
import { distanceText, placeText, quantityText } from '@/lib/listing-format';
import { otherSideBlock } from '@/lib/listing-page';
import { radius, spacing, useTheme } from '@/lib/theme';

interface OtherSideBlockProps {
  side: PartSide | null;
  result: OtherSideResult | undefined;
  loading: boolean;
  /** The matches couldn't be loaded: a line with Retry (`onRetry`). */
  error?: boolean;
  onRetry?: () => void;
  /** Opens a matching listing. */
  onOpen: (listingId: string) => void;
  /** "See all" → the Other side screen. */
  onSeeAll: () => void;
  style?: StyleProp<ViewStyle>;
}

/** "8 pcs, 18 km away" for an option; with the place for the lead line. */
const optionText = (c: OtherSideCard) => [quantityText(c.quantity, c.unit), distanceText(c.distanceKm)].filter(Boolean).join(', ');
const leadText = (c: OtherSideCard) =>
  [quantityText(c.quantity, c.unit), placeText(c), distanceText(c.distanceKm)].filter(Boolean).join(', ');

/**
 * The listing page's Other side block (F2 spec §8.1 item 5, mockup "Part listing" `.opts`): this listing's side, the
 * complementary side and Pair, each from the best match of that side or "Not listed"; the best match's line
 * ("Right side also available: …", or "Possibly the other side: …" for a tier-3 match) and See all. No match: "No right
 * side listed yet". The "Post a requirement" link waits for F8 (R22).
 */
export default function OtherSideBlock({ side, result, loading, error = false, onRetry, onOpen, onSeeAll, style }: OtherSideBlockProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.md },
    section: { ...type('section'), color: colors.text },
    opts: { flexDirection: 'row', gap: spacing.sm },
    opt: {
      flex: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
      borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, minHeight: 44,
    },
    optOn: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
    optLabel: { ...type('label'), color: colors.text },
    optSmall: { ...type('caption'), color: colors.textMuted, textAlign: 'center' },
    optPossible: { ...type('badge'), color: colors.onSun, backgroundColor: colors.sun, borderRadius: radius.full, paddingHorizontal: spacing.sm, overflow: 'hidden' },
    optSkeleton: { height: 14, width: '70%', borderRadius: radius.sm },
    errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    line: { ...type('body'), color: colors.text },
    none: { ...type('body'), color: colors.textSecondary },
    skeleton: { height: 20, borderRadius: radius.sm },
  }), [colors, type]);

  const block = otherSideBlock(side, result);
  if (!block) return null;

  const option = (key: 'this' | 'want' | 'pair') => {
    const kind = key === 'this' ? block.side : key === 'want' ? block.want : 'pair';
    const card = key === 'want' ? block.wantBest : key === 'pair' ? block.pairBest : null;
    // While loading (or after an error) the other tiles stay neutral rather than saying "Not listed".
    const unknown = key !== 'this' && !card && (loading || error);
    const small = key === 'this' ? t('listing.otherSide.thisListing') : card ? optionText(card) : t('listing.otherSide.notListed');
    const content = (
      <>
        <SideToken kind={kind} size="lg" />
        <Text style={s.optLabel}>{t(`listing.otherSide.short.${kind}`)}</Text>
        {card?.possible ? <Text style={s.optPossible}>{t('listing.otherSide.possibleShort')}</Text> : null}
        {unknown ? (loading ? <Skeleton style={s.optSkeleton} /> : null) : <Text style={s.optSmall} numberOfLines={2}>{small}</Text>}
      </>
    );
    if (!card) {
      return <View key={key} style={[s.opt, key === 'this' && s.optOn]}>{content}</View>;
    }
    return (
      <Pressable
        key={key}
        style={s.opt}
        onPress={() => onOpen(card.id)}
        testID={`Other-side-option-${kind}`}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  };

  const lead = block.lead;
  let line: string;
  if (!lead) line = t(`listing.otherSide.none_${block.want}`);
  else if (lead.possible) line = t('listing.otherSide.possible', { what: leadText(lead) });
  else if (lead.side === 'pair') line = t('listing.otherSide.availablePair', { what: leadText(lead) });
  else line = t(`listing.otherSide.available_${block.want}`, { what: leadText(lead) });

  return (
    <Card style={[s.card, style]}>
      <Text style={s.section}>{t('listing.otherSide.title')}</Text>
      <View style={s.opts}>
        {option('this')}
        {option('want')}
        {option('pair')}
      </View>
      {loading ? (
        <Skeleton style={s.skeleton} />
      ) : error ? (
        <View style={s.errorRow}>
          <Text style={s.none}>{t('listing.otherSide.loadError')}</Text>
          {onRetry ? (
            <Button title={t('common.retry')} onPress={onRetry} variant="ghost" size="sm" phLabel="Listing-other-side-retry" />
          ) : null}
        </View>
      ) : (
        <Text style={lead ? s.line : s.none}>{line}</Text>
      )}
      {lead && !loading && !error ? (
        <Button
          title={t('listing.otherSide.seeAllCount', { count: block.wantCount + block.pairCount })}
          onPress={onSeeAll}
          variant="outline"
          size="sm"
          phLabel="Listing-other-side-see-all"
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
    </Card>
  );
}
