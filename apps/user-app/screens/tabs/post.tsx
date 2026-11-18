import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { ListingKind } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ListRow from '@/components/ListRow';
import { useBusiness } from '@/hooks/use-business';
import { useDrafts } from '@/hooks/use-my-listings';
import { useCreateListing } from '@/hooks/use-sell-draft';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useType } from '@/hooks/use-type';
import { errorCode } from '@/lib/api-error';
import { BellRing, CalendarClock, ChevronRight, ClipboardList, Factory, Package, ShieldCheck, Wrench, type LucideIcon } from '@/lib/icons';
import { listingErrorMessage } from '@/lib/listing-errors';
import { canListRental } from '@/lib/sell-wizard';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';
import { useOpenGst } from '@/screens/sell/use-open-gst';

type Area = 'sellPart' | 'sellMachine' | 'rentMachine' | 'partRequest';

/**
 * What are you listing? (F2 spec §5.1, §15.1; mockup "What are you listing?"): a spare part or a machine for sale
 * creates a draft and opens the wizard's first step; a machine for rent needs GST verification (disabled with "Verify
 * GST" otherwise); a requirement is coming soon. "Drafts (n)" resumes unpublished listings; "My listings" opens them all.
 */
export default function PostScreen({ navigation }: TabScreenProps<'Post'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  // The floating tab bar draws over the screen's bottom (spec §7.5).
  const tabInset = useTabBarInset();
  const business = useBusiness();
  const drafts = useDrafts(!!business.data);
  const create = useCreateListing();
  const gst = useOpenGst();
  const [creating, setCreating] = useState<ListingKind | null>(null);
  // A second tap before the re-render would create a second draft.
  const starting = useRef(false);
  // The API's `403 RENTAL_NEEDS_GST` also disables the card (the profile in the cache can be older than a revocation).
  const [rentalRefused, setRentalRefused] = useState(false);
  // While the profile loads, the card isn't shown as locked (the API still refuses without GST).
  const rentalAllowed = (business.data === undefined || canListRental(business.data)) && !rentalRefused;
  const draftCount = drafts.data?.counts.drafts ?? 0;

  const s = useMemo(() => StyleSheet.create({
    // Scrolls, so a large font scale or Hindi / Gujarati copy never pushes the last card under the tab bar.
    body: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
    title: { ...type('title'), color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm },
    card: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    disabled: { opacity: 0.55 },
    iconWrap: {
      width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center',
    },
    text: { flex: 1 },
    cardTitle: { ...type('cardTitle'), color: colors.text },
    cardSubtitle: { ...type('caption'), color: colors.textSecondary, marginTop: spacing.xs },
    gate: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    gateText: { ...type('caption'), color: colors.warn, flex: 1 },
  }), [colors, type]);

  const start = async (kind: ListingKind) => {
    if (starting.current) return;
    starting.current = true;
    setCreating(kind);
    try {
      const listing = await create.mutateAsync(kind);
      navigation.navigate('Sell', { listingId: listing.id, step: 'category', mode: 'create' });
    } catch (err) {
      if (errorCode(err) === 'RENTAL_NEEDS_GST') setRentalRefused(true);
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    } finally {
      starting.current = false;
      setCreating(null);
    }
  };

  const card = (Icon: LucideIcon, area: Area, onPress: () => void, opts: { disabled?: boolean; kind?: ListingKind; footer?: React.ReactNode } = {}) => (
    <Pressable
      onPress={onPress}
      disabled={opts.disabled || creating !== null}
      testID={`Post-${area}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!opts.disabled, busy: creating === opts.kind }}
    >
      <Card>
        <View style={[s.card, opts.disabled && s.disabled]}>
          <View style={s.iconWrap}><Icon size={26} color={colors.primaryInk} /></View>
          <View style={s.text}>
            <Text style={s.cardTitle}>{t(`post.${area}.title`)}</Text>
            <Text style={s.cardSubtitle}>{t(`post.${area}.subtitle`)}</Text>
          </View>
          {creating && creating === opts.kind ? <ActivityIndicator color={colors.primary} /> : <ChevronRight size={20} color={colors.textMuted} />}
        </View>
        {opts.footer}
      </Card>
    </Pressable>
  );

  return (
    <ScreenWrapper edges={['top']} scroll contentContainerStyle={[s.body, { paddingBottom: tabInset }]}>
      <Text style={s.title}>{t('sell.post.title')}</Text>
      {card(Wrench, 'sellPart', () => void start('part'), { kind: 'part' })}
      {card(Factory, 'sellMachine', () => void start('machine'), { kind: 'machine' })}
      {card(CalendarClock, 'rentMachine', () => void start('machine_rental'), {
        kind: 'machine_rental',
        disabled: !rentalAllowed,
        footer: rentalAllowed ? null : (
          <View style={s.gate}>
            <ShieldCheck size={16} color={colors.warn} />
            <Text style={s.gateText}>{t('listing.errors.rentalNeedsGst')}</Text>
            <Button title={t('sell.verifyGst')} phLabel="Post-verify-gst" size="sm" variant="outline" loading={gst.opening} onPress={() => void gst.open()} />
          </View>
        ),
      })}
      {card(BellRing, 'partRequest', () => Toast.show({ type: 'info', text1: t('common.comingSoon') }))}
      <Card flush>
        {draftCount > 0 ? (
          <ListRow
            icon={ClipboardList}
            label={t('sell.post.drafts', { count: draftCount })}
            chevron
            onPress={() => navigation.navigate('MyDrafts')}
            testID="Post-drafts"
          />
        ) : null}
        <ListRow
          icon={Package}
          label={t('profile.rows.listings')}
          chevron
          last
          onPress={() => navigation.navigate('MyListings')}
          testID="Post-my-listings"
        />
      </Card>
    </ScreenWrapper>
  );
}
