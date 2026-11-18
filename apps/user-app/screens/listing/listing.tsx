import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { PUBLIC_LISTING_STATUSES, type ListingStatus } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { useListing, useListingTemplate, useOtherSide, useSellerListings } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { Info, Package, TriangleAlert } from '@/lib/icons';
import { contactActions, hasOtherSide } from '@/lib/listing-page';
import { editEntry, statusChip } from '@/lib/my-listings';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ManageSheet from '@/screens/my-listings/manage-sheet';
import CheckMyMachineSheet from './check-my-machine-sheet';
import ListingCardItem from './listing-card-item';
import ListingView from './listing-view';
import OtherSideBlock from './other-side-block';
import ReportSheet from './report-sheet';

/** "More from this seller" (§8.1 item 9): up to 6 of the seller's other public listings. */
const MORE_LIMIT = 6;

/**
 * The listing page (F2 spec §8; mockups "Part listing", "Machine listing", "Rental listing"): `ListingView` with the
 * Other side block, More from this seller, Check my machine and Report, under a FooterBar. Buyers get Enquire / Make
 * offer / Ask price, which answer "Coming soon" and track `listing_contact_tapped` until F6 (R6). The owner (any
 * status, through the owner view) gets Manage and Edit and a line saying whether buyers can see it.
 */
export default function ListingScreen({ navigation, route }: RootStackScreenProps<'Listing'>) {
  const { listingId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const query = useListing(listingId);
  const listing = query.data;
  const template = useListingTemplate(listing);
  const otherSide = useOtherSide(listingId, !!listing && hasOtherSide(listing));
  const more = useSellerListings(listing?.businessId ?? null, { limit: MORE_LIMIT, exclude: listingId });
  const [sheet, setSheet] = useState<'fit' | 'report' | null>(null);
  const [managing, setManaging] = useState(false);

  const s = useMemo(() => StyleSheet.create({
    loading: { padding: spacing.lg, gap: spacing.md },
    gallerySkeleton: { height: 300, borderRadius: radius.xl },
    lineSkeleton: { height: 28, borderRadius: radius.sm },
    owner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    ownerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    more: { gap: spacing.md },
    section: { ...type('section'), color: colors.text },
    footer: { paddingTop: spacing.sm },
  }), [colors, type]);

  const kindTitle = listing ? t(`listing.kind.${listing.kind}`) : '';

  if (!listing) {
    const missing = query.isError && errorCode(query.error) === 'LISTING_NOT_FOUND';
    return (
      <ScreenWrapper>
        <Header title={kindTitle} />
        {query.isLoading ? (
          <View style={s.loading}>
            <Skeleton style={s.gallerySkeleton} />
            <Skeleton style={s.lineSkeleton} />
            <Skeleton style={s.lineSkeleton} />
          </View>
        ) : missing ? (
          <EmptyState icon={Package} title={t('listing.page.notFoundTitle')} subtitle={t('listing.page.notFoundBody')} />
        ) : (
          <EmptyState
            icon={TriangleAlert}
            title={t('listing.page.loadErrorTitle')}
            subtitle={t('listing.page.loadErrorBody')}
            ctaTitle={t('common.retry')}
            ctaPhLabel="Listing-retry"
            onCtaPress={() => void query.refetch()}
          />
        )}
      </ScreenWrapper>
    );
  }

  const isOwner = listing.isOwner;
  const isPublic = (PUBLIC_LISTING_STATUSES as readonly ListingStatus[]).includes(listing.status);
  const chip = statusChip(listing.status);

  const ownerHeader = isOwner ? (
    <View style={s.owner}>
      <Notice tone={isPublic ? 'info' : 'warning'} icon={isPublic ? Info : TriangleAlert} text={t(isPublic ? 'listing.page.ownerPublic' : 'listing.page.ownerHiddenFromBuyers')}>
        <View style={s.ownerRow}><StatusChip label={t(chip.key)} tone={chip.tone} /></View>
      </Notice>
    </View>
  ) : null;

  const otherSideBlock = hasOtherSide(listing) ? (
    <OtherSideBlock
      side={listing.side}
      result={otherSide.data}
      loading={otherSide.isLoading}
      onOpen={(id) => navigation.push('Listing', { listingId: id })}
      onSeeAll={() => navigation.navigate('OtherSide', { listingId, from: isOwner ? 'mine' : 'listing' })}
    />
  ) : null;

  const moreCards = more.data ?? [];
  const moreFromSeller = moreCards.length > 0 ? (
    <View style={s.more}>
      <Text style={s.section}>{t('listing.page.moreTitle')}</Text>
      {moreCards.map((c) => (
        <ListingCardItem
          key={c.id}
          card={c}
          onPress={() => navigation.push('Listing', { listingId: c.id })}
          testID={`Listing-more-${c.ref}`}
        />
      ))}
    </View>
  ) : null;

  const contact = (action: ReturnType<typeof contactActions>[number]) => {
    track(LISTING_EVENTS.contactTapped, { action, kind: listing.kind });
    Toast.show({ type: 'info', text1: t('common.comingSoon') });
  };

  const edit = () => {
    const entry = editEntry(listing.status);
    if (entry === 'wizard') navigation.navigate('Sell', { listingId, step: 'category', mode: 'create' });
    else if (entry === 'menu') navigation.navigate('ListingEditMenu', { listingId });
  };

  return (
    <ScreenWrapper>
      <Header title={kindTitle} />
      <ListingView
        style={{ flex: 1 }}
        listing={listing}
        template={template.data ?? null}
        header={ownerHeader}
        otherSide={otherSideBlock}
        moreFromSeller={moreFromSeller}
        onOpenMedia={(index) => navigation.navigate('ListingMedia', { listingId, index })}
        onCheckFit={listing.fitments.length > 0 ? () => setSheet('fit') : undefined}
        onViewSeller={() => navigation.navigate('SellerListings', { businessId: listing.businessId })}
        onReport={isOwner ? undefined : () => setSheet('report')}
        bottomInset={spacing.lg}
      />
      <FooterBar style={s.footer}>
        {isOwner ? (
          <>
            <Button title={t('listing.owner.manage')} onPress={() => setManaging(true)} variant="outline" size="md" phLabel="Listing-manage" />
            {editEntry(listing.status) ? (
              <Button title={t('listing.owner.edit')} onPress={edit} size="md" phLabel="Listing-edit" />
            ) : null}
          </>
        ) : (
          contactActions(listing).map((a, i, all) => (
            <Button
              key={a}
              title={t(`listing.contact.${a}`)}
              onPress={() => contact(a)}
              variant={all.length > 1 && i === 0 ? 'outline' : 'primary'}
              size="md"
              phLabel={`Listing-contact-${a}`}
            />
          ))
        )}
      </FooterBar>

      {listing.fitments.length > 0 ? (
        <CheckMyMachineSheet visible={sheet === 'fit'} fitments={listing.fitments} onClose={() => setSheet(null)} />
      ) : null}
      {!isOwner ? (
        <ReportSheet visible={sheet === 'report'} listingId={listingId} listingTitle={listing.title} onClose={() => setSheet(null)} />
      ) : null}
      {isOwner ? <ManageSheet listing={managing ? listing : null} onClose={() => setManaging(false)} /> : null}
    </ScreenWrapper>
  );
}
