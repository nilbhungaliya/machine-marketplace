import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Button from '@/components/Button';
import ScreenWrapper from '@/components/ScreenWrapper';
import { useType } from '@/hooks/use-type';
import { Check, Clock } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * After Publish (F2 spec §5.5): "Your listing is live" or "Listing sent for review" (our team checks it; the result
 * shows in My listings), and "List another". Preview resets the stack to the Post tab under this screen, so Back and
 * Done land there.
 */
export default function SellPublishedScreen({ navigation, route }: RootStackScreenProps<'SellPublished'>) {
  const { outcome } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const live = outcome === 'live';

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
          {/* INTEGRATION: "Find the other side" for a left / right part (Task 28): `navigation.navigate('OtherSide', { listingId, from: 'mine' })`, shown when the listing's side is `left` or `right`. */}
          {/* INTEGRATION: "View in My listings" (Task 27): `navigation.navigate('MyListings', { group: live ? 'live' : 'review' })`. */}
          <Button title={t('sell.published.listAnother')} phLabel="Sell-published-list-another" onPress={() => navigation.popTo('Main', { screen: 'Post' })} />
          <Button title={t('common.done')} phLabel="Sell-published-done" variant="outline" onPress={() => navigation.popTo('Main', { screen: 'Home' })} />
        </View>
      </View>
    </ScreenWrapper>
  );
}
