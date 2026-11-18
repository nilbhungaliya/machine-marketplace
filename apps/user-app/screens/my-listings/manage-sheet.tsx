import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { SELLER_LISTING_ACTIONS, type ListingCard, type SellerListingAction } from '@mpm/shared-types';
import ActionSheet, { type ActionSheetItem } from '@/components/ActionSheet';
import { useConfirm } from '@/components/ConfirmSheet';
import { gstStateQuery } from '@/hooks/use-business';
import { useListingAction } from '@/hooks/use-listing';
import { gstScreen } from '@/lib/gst-flow';
import {
  ArrowLeftRight, Ban, Check, CircleX, Eye, Package, Pause, Pencil, Play, RefreshCw, RotateCcw, Tag, Trash, type LucideIcon,
} from '@/lib/icons';
import { listingErrorMessage, needsGstVerification } from '@/lib/listing-errors';
import { actionToastKey, editEntry, gateStep, manageItems, needsConfirm, type ManageItem } from '@/lib/my-listings';
import { queryClient } from '@/lib/queryClient';
import { openTarget } from '@/navigation/go';
import type { RootStackParamList } from '@/navigation/types';
import QuantitySheet from './quantity-sheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** What the manage sheet needs of a listing: a My listings card and the owner view both have it. */
export type ManageTarget = Pick<ListingCard, 'id' | 'status' | 'kind' | 'side' | 'title' | 'quantity' | 'unit'>;

const ICONS: Record<ManageItem, LucideIcon> = {
  edit: Pencil,
  quantity: Package,
  other_side: ArrowLeftRight,
  view: Eye,
  pause: Pause,
  resume: Play,
  renew: RefreshCw,
  mark_sold: Check,
  mark_unavailable: Ban,
  relist: RotateCcw,
  mark_rented: Tag,
  end_rental: CircleX,
  remove: Trash,
};

const isAction = (item: ManageItem): item is SellerListingAction =>
  (SELLER_LISTING_ACTIONS as readonly string[]).includes(item);

/**
 * Runs a seller action (F2 spec §7.2, §10): confirms Remove and Mark sold, posts it, and says what happened ("Sent to our
 * team for a quick check" when the gate sent a go-live action to review). A gate refusal (`LISTING_INCOMPLETE`) opens
 * the step that fixes it in edit mode; `UNVERIFIED_LISTING_CAP` offers Verify GST. Resolves true on success.
 */
export function useRunListingAction() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const confirm = useConfirm();
  const action = useListingAction();

  const run = useCallback(async (listing: ManageTarget, a: SellerListingAction): Promise<boolean> => {
    if (needsConfirm(a)) {
      const ok = await confirm({
        title: t(`listing.manage.confirm.${a}Title`),
        message: t(`listing.manage.confirm.${a}Message`),
        confirmLabel: t(`listing.manage.action.${a}`),
        destructive: true,
      });
      if (!ok) return false;
    }
    try {
      const res = await action.mutateAsync({ id: listing.id, action: a });
      Toast.show({ type: res.outcome === 'pending_review' ? 'info' : 'success', text1: t(actionToastKey(a, res.outcome)) });
      return true;
    } catch (err) {
      const step = gateStep(err, listing.kind);
      if (step) {
        Toast.show({ type: 'info', text1: listingErrorMessage(err) });
        navigation.navigate('Sell', { listingId: listing.id, step, mode: 'edit' });
      } else if (needsGstVerification(err)) {
        const verify = await confirm({ title: listingErrorMessage(err), confirmLabel: t('listing.manage.verifyGst') });
        if (verify) {
          try {
            openTarget(navigation, gstScreen(await queryClient.fetchQuery(gstStateQuery)));
          } catch {
            Toast.show({ type: 'error', text1: t('errors.genericRetry') });
          }
        }
      } else {
        Toast.show({ type: 'error', text1: listingErrorMessage(err) });
      }
      return false;
    }
  }, [action, confirm, navigation, t]);

  return { run, pending: action.isPending };
}

interface ManageSheetProps {
  /** The listing to manage; null = closed. The parent clears it in `onClose`. */
  listing: ManageTarget | null;
  /** Adds "View listing" (My listings; not on the listing page itself). */
  showView?: boolean;
  onClose: () => void;
}

/**
 * The manage sheet (F2 spec §10, mockup "Manage a listing"): Edit, Update quantity, the actions `sellerActions` allows,
 * Find the other side (left / right parts), View listing, Remove. Destructive actions confirm (`useRunListingAction`).
 */
export default function ManageSheet({ listing, showView = false, onClose }: ManageSheetProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
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

  const items: ActionSheetItem[] = listing
    ? manageItems(listing, { view: showView }).map((item) => ({
      key: item,
      label: isAction(item) ? t(`listing.manage.action.${item}`) : t(`listing.manage.${item}`),
      icon: ICONS[item],
      destructive: item === 'remove',
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
      const entry = editEntry(listing.status);
      if (entry === 'wizard') navigation.navigate('Sell', { listingId: listing.id, step: 'category', mode: 'create' });
      else if (entry === 'menu') navigation.navigate('ListingEditMenu', { listingId: listing.id });
      onClose();
    } else if (item === 'other_side') {
      navigation.navigate('OtherSide', { listingId: listing.id, from: 'mine' });
      onClose();
    } else if (item === 'view') {
      navigation.navigate('Listing', { listingId: listing.id });
      onClose();
    } else {
      void run(listing, item).finally(onClose);
    }
  };

  return (
    <>
      <ActionSheet
        visible={open === 'menu'}
        title={listing?.title}
        items={items}
        onSelect={select}
        onClose={close}
      />
      <QuantitySheet listing={listing} visible={open === 'quantity'} onClose={close} />
    </>
  );
}
