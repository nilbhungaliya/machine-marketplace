import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Button from '@/components/Button';
import Notice from '@/components/Notice';
import ScreenWrapper from '@/components/ScreenWrapper';
import SideToken from '@/components/SideToken';
import { useOwnerListing } from '@/hooks/use-listing';
import { useListingDemand } from '@/hooks/use-seller-part-requests';
import { useType } from '@/hooks/use-type';
import { ArrowLeftRight, Check, ClipboardList, Clock } from '@/lib/icons';
import { askPushOnce } from '@/lib/push-ask';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * After Publish (F2 spec §5.5): "Your listing is live" or "Listing sent for review" (our team checks it; the result
 * shows in My listings), "List another", "View in My listings" (its group), and "Find the other side" for a left or
 * right part (§9). Preview resets the stack to the Post tab under this screen, so Back and Done land there.
 *
 * F8 (spec §13.2, §9.3): "{n} buyers are looking for this part" from the listing's demand ("We will tell them when it
 * goes live" in review, "We've told them" when live) with "See their requirements" → Buyers looking `{ forListing }`,
 * hidden at 0; and, for a draft made to answer a request, where its pending reply stands.
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
  const demand = useListingDemand(listingId);
  const demandCount = demand.data?.count ?? 0;
  const pending = owner.data?.pendingRequestReply ?? null;
  const side = owner.data?.kind === 'part' ? owner.data.side : null;
  const wantKind = side === 'left' ? 'want-left' : side === 'right' ? 'want-right' : side === 'pair' ? 'pair' : null;

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
    match: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg,
      backgroundColor: colors.primaryWash,
    },
    matchBody: { flex: 1, gap: 2 },
    matchTitle: { ...type('bodyStrong'), color: colors.text },
    matchText: { ...type('body'), color: colors.textSecondary },
  }), [colors, type, live]);

  return (
    <ScreenWrapper>
      <View style={s.body}>
        <View style={s.mark}>
          {live ? <Check size={40} color={colors.ok} /> : <Clock size={40} color={colors.primaryInk} />}
        </View>
        <Text style={s.title} accessibilityRole="header">{t(live ? 'sell.published.liveTitle' : 'sell.published.reviewTitle')}</Text>
        <Text style={s.lead}>{t(live ? 'sell.published.liveLead' : 'sell.published.reviewLead')}</Text>
        {pending ? (
          <Notice
            tone="info"
            icon={ClipboardList}
            title={t('buyers.sell.pendingTitle', { name: pending.name })}
            text={t(live ? 'buyers.sell.pendingLive' : 'buyers.sell.pendingBody')}
          />
        ) : null}
        {demandCount > 0 ? (
          <View style={s.match} testID="Sell-published-demand">
            {wantKind ? <SideToken kind={wantKind} size="lg" /> : <ClipboardList size={24} color={colors.primaryInk} />}
            <View style={s.matchBody}>
              <Text style={s.matchTitle}>{t('buyers.sell.demand', { count: demandCount })}</Text>
              <Text style={s.matchText}>{t(live ? 'buyers.sell.demandLive' : 'buyers.sell.demandReview')}</Text>
              <Button
                title={t('buyers.sell.seeRequirements')}
                variant="ghost"
                size="sm"
                onPress={() => navigation.navigate('BuyersLooking', { forListing: listingId })}
                phLabel="Sell-published-see-requirements"
                style={{ alignSelf: 'flex-start' }}
              />
            </View>
          </View>
        ) : null}
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
