import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PUBLIC_LISTING_STATUSES, quantityToMilli, type ListingStatus } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import SaveButton from '@/components/SaveButton';
import EnquireSheet from '@/components/chat/EnquireSheet';
import OfferSheet from '@/components/offers/OfferSheet';
import { useCards } from '@/hooks/use-discover';
import { useHeartViewer } from '@/hooks/use-saved';
import { recordViewed } from '@/lib/recently-viewed';
import { listingHeart } from '@/lib/saved-view';
import { listingKeys, useListing, useListingTemplate, useOtherSide, useSellerListings } from '@/hooks/use-listing';
import { useRequireSignIn } from '@/hooks/use-require-sign-in';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { Info, Package, TriangleAlert } from '@/lib/icons';
import { quantityText } from '@/lib/listing-format';
import {
  arrivalAction, contactButtons, contactSheets, hasOtherSide, isListingGone, pendingContactOf, sheetOf, signInReasonOf,
  type ContactButtonAction,
} from '@/lib/listing-page';
import { editEntry, manageItems, ownerNote, statusChip, type ManageAction } from '@/lib/my-listings';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { ListingSheet, RootStackScreenProps } from '@/navigation/types';
import ManageSheet, { openEdit } from '@/screens/my-listings/manage-sheet';
import CheckMyMachineSheet from './check-my-machine-sheet';
import ListingCardItem from './listing-card-item';
import ListingView from './listing-view';
import OtherSideBlock from './other-side-block';
import ReportSheet from './report-sheet';
import AvailabilityStrip from '@/components/rentals/AvailabilityStrip';
import { useRentalAvailability } from '@/hooks/use-rental-booking';
import { CalendarClock, ClipboardList } from '@/lib/icons';

/** "More from this seller" (§8.1 item 9): up to 6 of the seller's other public listings. */
const MORE_LIMIT = 6;

/**
 * The listing page (F2 spec §8; mockups "Part listing", "Machine listing", "Rental listing"): `ListingView` with the
 * Other side block, More from this seller, Check my machine and Report, under a FooterBar. Buyers get the contact
 * buttons of F6 + F7 §7.1 (`contactButtons`): Enquire / Make offer / Buy at this price / Ask price, "Open chat" once
 * they have a thread, Make offer / Buy disabled while everything is on hold; a guest is asked to sign in with a
 * pending action that reopens this page with the sheet (`openSheet`, §15.2). The owner (any status, through the owner
 * view) gets Manage and Edit, a line saying whether buyers can see it and "On hold in deals: n".
 */
export default function ListingScreen({ navigation, route }: RootStackScreenProps<'Listing'>) {
  const { listingId, openSheet } = route.params;
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Reporting needs an account (the API's `requireUser`): a guest gets the sign-in sheet (F4 + F5 spec §8.1).
  const { requireSignIn } = useRequireSignIn();
  const { colors } = useTheme();
  const type = useType();
  const query = useListing(listingId);
  const listing = query.data;
  const template = useListingTemplate(listing);
  const otherSide = useOtherSide(listingId, !!listing && hasOtherSide(listing));
  const more = useSellerListings(listing?.businessId ?? null, { limit: MORE_LIMIT, exclude: listingId });
  const [sheet, setSheet] = useState<'fit' | 'report' | ListingSheet | null>(null);
  const [managing, setManaging] = useState(false);
  // The heart (F4 + F5 spec §8.5): the detail's `saved` isn't computed by the API, so a signed-in buyer's state comes
  // from this listing's card (`POST /discover/cards`, patched by every toggle like any other cached card).
  const viewer = useHeartViewer();
  const wantsCard = !!listing && !listing.isOwner && viewer.signedIn;
  const cardQuery = useCards(useMemo(() => [listingId], [listingId]), null, wantsCard);
  const cardSaved = cardQuery.data ? cardQuery.data.find((c) => c.id === listingId)?.saved ?? null : undefined;
  // M14 (R13): the 30-day availability strip of a rental (public; free / partly booked / full, never who).
  const isRental = listing?.kind === 'machine_rental';
  const availability = useRentalAvailability(listingId, null, isRental);

  // Recently viewed (§8.5, R13): on the phone only, own listings skipped; once per opened listing.
  const loaded = !!listing && listing.id === listingId;
  useEffect(() => {
    if (!loaded || !listing) return;
    void recordViewed({ listingId, businessId: listing.businessId }, listing.isOwner ? listing.businessId : null);
  }, [loaded, listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A guest's pending Enquire / Offer / Buy / Ask price (F6 + F7 §15.2): opens that sheet once the listing is here,
  // then clears the param so it opens once. Never sends anything by itself.
  useEffect(() => {
    if (!openSheet || !loaded || !listing) return;
    navigation.setParams({ openSheet: undefined });
    const next = arrivalAction(openSheet, contactButtons(listing));
    if (next?.type === 'sheet') setSheet(next.sheet);
    else if (next?.type === 'thread' && listing.myThreadId) navigation.navigate('Thread', { threadId: listing.myThreadId });
  }, [openSheet, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    loading: { padding: spacing.lg, gap: spacing.md },
    gallerySkeleton: { height: 300, borderRadius: radius.xl },
    lineSkeleton: { height: 28, borderRadius: radius.sm },
    owner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    ownerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    ownerNote: { ...type('caption'), color: colors.text },
    heldLink: { alignSelf: 'flex-start' },
    rentalOwner: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    more: { gap: spacing.md },
    section: { ...type('section'), color: colors.text },
    footer: { paddingTop: spacing.sm },
  }), [colors, type]);

  const kindTitle = listing ? t(`listing.kind.${listing.kind}`) : '';

  // A refetch that answers 404 (removed, hidden, sold elsewhere) leaves the old data cached: the page is gone anyway.
  const gone = isListingGone(query.isError, query.error);
  if (!listing || gone) {
    const missing = gone;
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
  const note = isOwner && 'version' in listing ? ownerNote(listing) : null;
  const canManage = isOwner && manageItems(listing).length > 0;
  // F6 + F7 §8.4: the owner sees how much is on hold in open deals, linking to the Deals tab.
  const heldRaw = isOwner && 'heldQuantity' in listing ? listing.heldQuantity : null;
  const held = heldRaw && quantityToMilli(heldRaw) > 0n ? heldRaw : null;

  // M14 (D14): the owner's booking summary ("2 requests to answer · 1 booked · 1 out today").
  const summary = isOwner && 'bookingSummary' in listing ? listing.bookingSummary : null;
  const bookingLine = summary
    ? [
      summary.openRequests > 0 ? t('rentals.listing.openRequests', { count: summary.openRequests }) : null,
      summary.activeBookings > 0 ? t('rentals.listing.activeBookings', { count: summary.activeBookings }) : null,
      summary.outToday > 0 ? t('rentals.listing.outToday', { count: summary.outToday }) : null,
    ].filter(Boolean).join(' · ') || t('rentals.listing.noBookings')
    : null;

  const ownerHeader = isOwner ? (
    <View style={s.owner}>
      <Notice tone={isPublic ? 'info' : 'warning'} icon={isPublic ? Info : TriangleAlert} text={t(isPublic ? 'listing.page.ownerPublic' : 'listing.page.ownerHiddenFromBuyers')}>
        <View style={s.ownerRow}><StatusChip label={t(chip.key)} tone={chip.tone} /></View>
        {note ? <Text style={s.ownerNote}>{t(note.key, note.values)}</Text> : null}
        {bookingLine ? <Text style={s.ownerNote}>{bookingLine}</Text> : null}
        {isRental ? (
          <View style={s.rentalOwner}>
            <Button
              title={t('rentals.listing.calendar')}
              onPress={() => navigation.navigate('RentalCalendar', { listingId })}
              variant="outline"
              size="sm"
              icon={CalendarClock}
              phLabel="Listing-rental-calendar"
            />
            <Button
              title={t('rentals.listing.bookings')}
              onPress={() => navigation.navigate('Main', { screen: 'Deals', params: { segment: 'rentals', listingId } })}
              variant="outline"
              size="sm"
              icon={ClipboardList}
              phLabel="Listing-rental-bookings"
            />
          </View>
        ) : null}
        {held ? (
          <Button
            title={t('listing.owner.onHold', { qty: quantityText(held, listing.unit) })}
            onPress={() => navigation.navigate('Main', { screen: 'Deals' })}
            variant="ghost"
            size="sm"
            phLabel="Listing-on-hold"
            style={s.heldLink}
          />
        ) : null}
      </Notice>
    </View>
  ) : null;

  // A rental draws its availability strip in the Other side slot (block 5, right after the rates and terms): rentals
  // never have an Other side.
  const otherSideBlock = isRental ? (
    <AvailabilityStrip
      days={availability.data}
      loading={availability.isLoading}
      error={availability.isError}
      onRetry={() => void availability.refetch()}
    />
  ) : hasOtherSide(listing) ? (
    <OtherSideBlock
      side={listing.side}
      result={otherSide.data}
      loading={otherSide.isLoading}
      error={otherSide.isError}
      onRetry={() => void otherSide.refetch()}
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

  const contact = contactButtons(listing);
  // The last footer button is the violet one: on a rental that is Request booking, with Enquire beside it in outline
  // (M14 R13, mockup rental · "Rental listing").
  const footerButtons = [...contact.buttons].sort(
    (a, b) => Number(a.action === 'request_booking') - Number(b.action === 'request_booking'),
  );
  const sheets = contactSheets({ isOwner, kind: listing.kind, priceModel: listing.priceModel });
  const tapContact = (action: ContactButtonAction) => {
    track(LISTING_EVENTS.contactTapped, { action, kind: listing.kind });
    if (action === 'open_chat') {
      if (listing.myThreadId) navigation.navigate('Thread', { threadId: listing.myThreadId });
      return;
    }
    // Login at the moment of intent (R24): the pending action reopens this page with the sheet after sign-in.
    if (!requireSignIn({ reason: signInReasonOf(action), pending: pendingContactOf(action, listingId) })) return;
    // M14: Request booking opens its own screen (a guest gets here after sign-in through the pending action).
    if (action === 'request_booking') {
      navigation.navigate('RequestBooking', { listingId });
      return;
    }
    setSheet(sheetOf(action));
  };
  const toThread = (threadId: string) => {
    void qc.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
    navigation.navigate('Thread', { threadId });
  };

  const edit = () => void openEdit(navigation, qc, listing);

  const heart = listingHeart(listing, viewer, cardSaved);
  const heartButton = heart.show ? (
    <SaveButton listingId={listingId} saved={heart.saved} size="md" testID="Listing-save" />
  ) : null;

  // Removed or deleted from this page: there's nothing left to show, so drop it and go back.
  const actionDone = (a: ManageAction) => {
    if (a !== 'remove' && a !== 'delete_draft') return;
    qc.removeQueries({ queryKey: listingKeys.detail(listingId) });
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <ScreenWrapper>
      <Header title={kindTitle} rightIcon={heartButton} />
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
        onReport={isOwner ? undefined : () => { if (requireSignIn({ reason: 'report' })) setSheet('report'); }}
        onViewReviews={() => navigation.navigate('SellerReviews', { businessId: listing.businessId })}
        bottomInset={spacing.lg}
      />
      <FooterBar style={s.footer}>
        {isOwner ? (
          <>
            {canManage ? (
              <Button title={t('listing.owner.manage')} onPress={() => setManaging(true)} variant="outline" size="md" phLabel="Listing-manage" />
            ) : null}
            {editEntry(listing.status) ? (
              <Button title={t('listing.owner.edit')} onPress={edit} size="md" phLabel="Listing-edit" />
            ) : null}
          </>
        ) : (
          footerButtons.map((b, i, all) => (
            <Button
              key={b.action}
              title={b.disabled ? t('listing.contact.allOnHold') : t(`listing.contact.${b.action}`)}
              onPress={() => tapContact(b.action)}
              disabled={b.disabled}
              variant={all.length > 1 && i === 0 ? 'outline' : 'primary'}
              size="md"
              phLabel={`Listing-contact-${b.action}`}
            />
          ))
        )}
      </FooterBar>

      {listing.fitments.length > 0 ? (
        <CheckMyMachineSheet visible={sheet === 'fit'} fitments={listing.fitments} onClose={() => setSheet(null)} />
      ) : null}
      {sheets.enquire ? (
        <EnquireSheet
          listing={listing}
          visible={sheet === 'enquire' || sheet === 'ask_price'}
          preset={sheet === 'ask_price' ? 'ask_price' : undefined}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheets.offer ? (
        <OfferSheet
          mode={sheet === 'buy' ? 'buy' : 'offer'}
          listing={listing}
          visible={sheet === 'offer' || sheet === 'buy'}
          onClose={() => setSheet(null)}
          onSent={(r) => toThread(r.threadId)}
        />
      ) : null}
      {!isOwner ? (
        <ReportSheet visible={sheet === 'report'} listingId={listingId} listingTitle={listing.title} onClose={() => setSheet(null)} />
      ) : null}
      {canManage ? (
        <ManageSheet listing={managing ? listing : null} onActionDone={actionDone} onClose={() => setManaging(false)} />
      ) : null}
    </ScreenWrapper>
  );
}
