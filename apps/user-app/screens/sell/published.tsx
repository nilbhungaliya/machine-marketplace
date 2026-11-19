import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Button from '@/components/Button';
import ScreenWrapper from '@/components/ScreenWrapper';
import { useOwnerListing } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { ArrowLeftRight, Check, Clock } from '@/lib/icons';
import { askPushOnce } from '@/lib/push-ask';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * After Publish (F2 spec §5.5): "Your listing is live" or "Listing sent for review" (our team checks it; the result
 * shows in My listings), "List another", "View in My listings" (its group), and "Find the other side" for a left or
 * right part (§9). Preview resets the stack to the Post tab under this screen, so Back and Done land there.
 */
export default function SellPublishedScreen({ navigation, route }: RootStackScreenProps<'SellPublished'>) {
  const { listingId, outcome } = route.params;
  // The owner view Preview published from (in the cache): only a left / right part has an other side to find.
  const owner = useOwnerListing(listingId);
  const oneSide = owner.data?.kind === 'part' && (owner.data.side === 'left' || owner.data.side === 'right');
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const live = outcome === 'live';

  // F6 + F7 §11.6: a published listing is a moment to offer notifications (once per install, explainer first).
  useEffect(() => {
    void askPushOnce('publish');
  }, []);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.lg },
    mark: {
      alignSelf: 'center', width: 88, height: 88, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
      backgroundColor: live ? colors.okSoft : colors.primaryWash,
    },
    title: { ...type('title'), color: colors.text, textAlign: 'center' },
    lead: { ...type('lead'), color: colors.textSecondary, textAlign: 'center' },
    actions: { gap: spacing.sm, marginTop: spacing.lg },
  }), [colors, type, live]);

  return (
    <ScreenWrapper>
      <View style={s.body}>
        <View style={s.mark}>
          {live ? <Check size={40} color={colors.ok} /> : <Clock size={40} color={colors.primaryInk} />}
        </View>
        <Text style={s.title} accessibilityRole="header">{t(live ? 'sell.published.liveTitle' : 'sell.published.reviewTitle')}</Text>
        <Text style={s.lead}>{t(live ? 'sell.published.liveLead' : 'sell.published.reviewLead')}</Text>
        <View style={s.actions}>
          <Button title={t('sell.published.listAnother')} phLabel="Sell-published-list-another" onPress={() => navigation.popTo('Main', { screen: 'Post' })} />
          {oneSide ? (
            <Button
              title={t('listing.manage.other_side')}
              phLabel="Sell-published-other-side"
              variant="outline"
              icon={ArrowLeftRight}
              onPress={() => navigation.navigate('OtherSide', { listingId, from: 'mine' })}
            />
          ) : null}
          <Button
            title={t('sell.published.viewMine')}
            phLabel="Sell-published-my-listings"
            variant="outline"
            onPress={() => navigation.replace('MyListings', { group: live ? 'live' : 'review' })}
          />
          <Button title={t('common.done')} phLabel="Sell-published-done" variant="ghost" onPress={() => navigation.popTo('Main', { screen: 'Home' })} />
        </View>
      </View>
    </ScreenWrapper>
  );
}
