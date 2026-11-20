import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  SELLER_LISTING_ACTIONS, type CategoryNode, type ListingCard, type MyListingCard, type SellerListingAction,
} from '@mpm/shared-types';
import ActionSheet, { type ActionSheetItem } from '@/components/ActionSheet';
import { useConfirm } from '@/components/ConfirmSheet';
import { gstStateQuery } from '@/hooks/use-business';
import { catalogKeys, invalidateListingLists, listingKeys, useListingAction } from '@/hooks/use-listing';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { gstScreen } from '@/lib/gst-flow';
import {
  ArrowLeftRight, Ban, CalendarClock, Check, ClipboardList, Eye, Package, Pause, Pencil, Play, RefreshCw, RotateCcw, Trash,
  type LucideIcon,
} from '@/lib/icons';
import { deleteDraft, fetchOwnerListing } from '@/lib/listing-api';
import { listingWriteErrorMessage } from '@/lib/f6-errors';
import { needsGstVerification } from '@/lib/listing-errors';
import { errorCode } from '@/lib/api-error';
import { quantityText } from '@/lib/listing-format';
import { holdsManageItems, holdsOf, openDealIds, pauseNeedsWarning } from '@/lib/my-listings-holds';
import {
  actionToastKey, editEntry, gateStep, isStaleListingError, manageItems, needsConfirm, nodeHasSides, wizardStartStep,
  type ManageAction, type ManageItem,
} from '@/lib/my-listings';
import { openTarget } from '@/navigation/go';
import type { RootStackParamList } from '@/navigation/types';
import QuantitySheet from './quantity-sheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** What the manage sheet needs of a listing: a My listings card and the owner view both have it. */
export type ManageTarget = Pick<
  ListingCard, 'id' | 'status' | 'kind' | 'side' | 'title' | 'quantity' | 'availableQuantity' | 'unit' | 'businessId'
> & {
  /** A rental's bookings for "Bookings (n)" (My listings cards, M14 D14); absent elsewhere ("Bookings"). */
  rentalLine?: MyListingCard['rentalLine'];
};


const ICONS: Record<ManageItem, LucideIcon> = {
  calendar: CalendarClock,
  bookings: ClipboardList,
  edit: Pencil,
  quantity: Package,
  other_side: ArrowLeftRight,
  view: Eye,
  delete_draft: Trash,
  pause: Pause,
  resume: Play,
  renew: RefreshCw,
  mark_sold: Check,
  mark_unavailable: Ban,
  relist: RotateCcw,
  remove: Trash,
};

const isAction = (item: ManageItem): item is SellerListingAction =>
  (SELLER_LISTING_ACTIONS as readonly string[]).includes(item);

/** The Deals tab's Rentals list for one listing (M14 plan C0-5 params; My listings › Bookings (n)). */
const openBookings = (navigation: Nav, listingId: string) =>
  navigation.navigate('Main', { screen: 'Deals', params: { segment: 'rentals', listingId } });

/** A manage-sheet row's label: Calendar, "Bookings (n)" (M14 §14.1), a seller action, or the other rows. */
function itemLabel(t: (key: string, values?: Record<string, unknown>) => string, item: ManageItem, listing: ManageTarget): string {
  if (item === 'calendar') return t('rentalsOwner.manage.calendar');
  if (item === 'bookings') {
    const n = listing.rentalLine?.activeBookings;
    return n != null ? t('rentalsOwner.manage.bookingsCount', { n }) : t('rentalsOwner.manage.bookings');
  }
  return isAction(item) ? t(`listing.manage.action.${item}`) : t(`listing.manage.${item}`);
}

/**
 * Opens Edit for a listing (§10, R43): the Edit listing menu for a published one; the wizard for a draft (at its first
 * incomplete step, from the owner view) or a rejected listing (at the category step). Nothing for hidden / removed /
 * reserved.
 */
export async function openEdit(navigation: Nav, qc: QueryClient, listing: Pick<ListingCard, 'id' | 'status'>): Promise<void> {
  const entry = editEntry(listing.status);
  if (entry === 'menu') {
    navigation.navigate('ListingEditMenu', { listingId: listing.id });
  } else if (entry === 'wizard') {
    let step: RootStackParamList['Sell']['step'] = 'category';
    if (listing.status === 'draft') {
      try {
        const view = await qc.fetchQuery({ queryKey: listingKeys.owner(listing.id), queryFn: () => fetchOwnerListing(listing.id) });
        step = wizardStartStep(view, nodeHasSides(qc.getQueryData<CategoryNode[]>(catalogKeys.tree), view.categoryId));
      } catch {
        // Without the owner view, the wizard starts at the category step (Next walks forward from there).
      }
    }
    navigation.navigate('Sell', { listingId: listing.id, step, mode: 'create' });
  }
}

/**
 * Runs a manage-sheet action (F2 spec §7.2, §10): confirms Remove, Mark sold and Delete draft, posts it, and says what
 * happened ("Sent to our team for a quick check" when the gate sent a go-live action to review). A gate refusal
 * (`LISTING_INCOMPLETE`) opens the step that fixes it in edit mode; `UNVERIFIED_LISTING_CAP` offers Verify GST; a
 * stale copy (`LISTING_TRANSITION_NOT_ALLOWED`, `LISTING_NOT_EDITABLE`, `404`) refreshes the lists. Resolves true on
 * success.
 *
 * F6 + F7 (§8.3): Pause on a live or reserved listing confirms first (open offers and backups close for good);
 * `409 LISTING_HAS_OPEN_DEALS` (stock on hold, a stale card) says "Cancel the open deals first" and opens them.
 */
export function useRunListingAction() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const action = useListingAction();
  const removeDraft = useMutation({ mutationFn: (id: string) => deleteDraft(id) });

  const run = useCallback(async (listing: ManageTarget, a: ManageAction): Promise<boolean> => {
    if (a === 'pause' && pauseNeedsWarning(listing.status)) {
      const ok = await confirm({
        title: t('holds.pauseTitle'),
        message: t('holds.pauseMessage'),
        confirmLabel: t('listing.manage.action.pause'),
      });
      if (!ok) return false;
    }
    if (needsConfirm(a)) {
      const ok = await confirm({
        title: t(`listing.manage.confirm.${a}Title`),
        message: t(`listing.manage.confirm.${a}Message`),
        confirmLabel: a === 'delete_draft' ? t('listing.manage.delete_draft') : t(`listing.manage.action.${a}`),
        destructive: true,
      });
      if (!ok) return false;
    }
    try {
      if (a === 'delete_draft') {
        await removeDraft.mutateAsync(listing.id);
        qc.removeQueries({ queryKey: listingKeys.owner(listing.id) });
        invalidateListingLists(qc, listing.id, listing.businessId);
        track(LISTING_EVENTS.actionDone, { action: a, outcome: 'deleted' });
        Toast.show({ type: 'success', text1: t(actionToastKey(a, listing.status)) });
        return true;
      }
      const res = await action.mutateAsync({ id: listing.id, action: a });
      Toast.show({ type: res.outcome === 'pending_review' ? 'info' : 'success', text1: t(actionToastKey(a, res.outcome)) });
      return true;
    } catch (err) {
      const step = gateStep(err, listing.kind);
      const dealIds = openDealIds(err);
      const openBookingsErr = errorCode(err) === 'LISTING_HAS_OPEN_BOOKINGS';
      if (isStaleListingError(err) || dealIds || openBookingsErr) invalidateListingLists(qc, listing.id, listing.businessId);
      if (openBookingsErr) {
        // M14 §7.2: remove / mark unavailable wait for the rental's bookings in progress.
        const open = await confirm({
          title: t('rentals.errors.listingHasOpenBookings'),
          confirmLabel: t('rentalsOwner.manage.seeBookings'),
        });
        if (open) openBookings(navigation, listing.id);
      } else if (dealIds) {
        const open = await confirm({ title: t('holds.openDealsTitle'), message: t('holds.openDealsBody'), confirmLabel: t('holds.goToDeals') });
        if (open) {
          if (dealIds.length === 1) navigation.navigate('DealRecord', { dealId: dealIds[0]! });
          else navigation.navigate('Main', { screen: 'Deals' });
        }
      } else if (step) {
        Toast.show({ type: 'info', text1: listingWriteErrorMessage(err) });
        navigation.navigate('Sell', { listingId: listing.id, step, mode: 'edit' });
      } else if (needsGstVerification(err)) {
        const verify = await confirm({ title: listingWriteErrorMessage(err), confirmLabel: t('listing.manage.verifyGst') });
        if (verify) {
          try {
            openTarget(navigation, gstScreen(await qc.fetchQuery(gstStateQuery)));
          } catch {
            Toast.show({ type: 'error', text1: t('errors.genericRetry') });
          }
        }
      } else {
        Toast.show({ type: 'error', text1: listingWriteErrorMessage(err) });
      }
      return false;
    }
  }, [action, removeDraft, confirm, navigation, qc, t]);

  return { run, pending: action.isPending || removeDraft.isPending };
}

interface ManageSheetProps {
  /** The listing to manage; null = closed. The parent clears it in `onClose`. */
  listing: ManageTarget | null;
  /** Adds "View listing" (My listings; not on the listing page itself). */
  showView?: boolean;
  /** After an action succeeded (the listing page leaves a removed listing or a deleted draft). */
  onActionDone?: (action: ManageAction) => void;
  onClose: () => void;
}

/**
 * The manage sheet (F2 spec §10, mockup "Manage a listing"): Edit, Update quantity, the actions `sellerActions` allows,
 * Find the other side (left / right parts), View listing, Remove; a draft gets Edit and Delete draft. Destructive
 * actions confirm (`useRunListingAction`). With stock on hold in deals (F6 + F7 §8.3) Mark sold and Remove are left
 * out and the sheet says why; a `reserved` listing keeps Edit. A machine for rent starts with Calendar and Bookings (n)
 * (M14 §14.1: the owner calendar, and the Deals tab's Rentals filtered to the listing).
 */
export default function ManageSheet({ listing, showView = false, onActionDone, onClose }: ManageSheetProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const { run } = useRunListingAction();
  const [open, setOpen] = useState<'menu' | 'quantity' | null>(null);

  // Opens when a listing is given; a refetch of the same listing (a new object) doesn't reopen it.
  const openId = listing?.id ?? null;
  useEffect(() => {
    setOpen(openId ? 'menu' : null);
  }, [openId]);

  const close = () => {
    setOpen(null);
    onClose();
  };

  const holds = listing ? holdsOf(listing) : null;
  const items: ActionSheetItem[] = listing
    ? holdsManageItems(manageItems(listing, { view: showView }), holds).map((item) => ({
      key: item,
      label: itemLabel(t, item, listing),
      icon: ICONS[item],
      destructive: item === 'remove' || item === 'delete_draft',
      testID: `Manage-${item}`,
    }))
    : [];

  const select = (key: string) => {
    if (!listing) return;
    const item = key as ManageItem;
    if (item === 'quantity') {
      setOpen('quantity');
      return;
    }
    // Close the sheet before a confirm or a new screen opens over it.
    setOpen(null);
    if (item === 'edit') {
      void openEdit(navigation, qc, listing).finally(onClose);
    } else if (item === 'other_side') {
      navigation.navigate('OtherSide', { listingId: listing.id, from: 'mine' });
      onClose();
    } else if (item === 'calendar') {
      navigation.navigate('RentalCalendar', { listingId: listing.id });
      onClose();
    } else if (item === 'bookings') {
      openBookings(navigation, listing.id);
      onClose();
    } else if (item === 'view') {
      navigation.navigate('Listing', { listingId: listing.id });
      onClose();
    } else {
      void run(listing, item)
        .then((ok) => { if (ok) onActionDone?.(item); })
        .finally(onClose);
    }
  };

  return (
    <>
      <ActionSheet
        visible={open === 'menu'}
        title={listing?.title}
        subtitle={holds?.hasHolds ? t('holds.manageNote', { held: quantityText(holds.held, listing?.unit) }) : undefined}
        items={items}
        onSelect={select}
        onClose={close}
      />
      <QuantitySheet listing={listing} visible={open === 'quantity'} onClose={close} />
    </>
  );
}
