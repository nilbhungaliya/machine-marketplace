import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useMutation } from '@tanstack/react-query';
import type { ListingCard } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import { FieldHint } from '@/components/Field';
import Input from '@/components/Input';
import { useStoreOwnerView } from '@/hooks/use-listing';
import { patchListing } from '@/lib/listing-api';
import { listingWriteErrorMessage } from '@/lib/f6-errors';
import { quantityText, unitLabel } from '@/lib/listing-format';
import { holdsOf, isBelowHeld } from '@/lib/my-listings-holds';
import { quantityToastKey } from '@/lib/my-listings';
import { formatQuantity, parseMachineCount, parseQuantity } from '@/lib/quantity';

export type QuantityTarget = Pick<ListingCard, 'id' | 'kind' | 'status' | 'quantity' | 'availableQuantity' | 'unit' | 'title'>;

interface QuantitySheetProps {
  listing: QuantityTarget | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * Update quantity (F2 spec §10): one field, saved with `PATCH /listings/:id { quantity }`. Parts use the unit's
 * decimals; machines and rentals a whole number 1–1000. Zero is refused with "Use Mark sold instead" (R41).
 * F6 + F7 (§8.3): never below what is on hold in open deals (checked here, and `409 QUANTITY_BELOW_HELD` from the API).
 */
export default function QuantitySheet({ listing, visible, onClose }: QuantitySheetProps) {
  const { t } = useTranslation();
  const store = useStoreOwnerView();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (v: { id: string; quantity: string }) => patchListing(v.id, { quantity: v.quantity }),
    onSuccess: (view) => store(view),
  });

  // Reset when the sheet opens for a listing (not when a refetch hands over a new object of the same listing).
  const listingId = listing?.id ?? null;
  const current = listing?.quantity ?? null;
  useEffect(() => {
    if (!visible || !listingId) return;
    setText(formatQuantity(current).replace(/,/g, ''));
    setError(undefined);
  }, [visible, listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const holds = listing ? holdsOf(listing) : null;

  const submit = () => {
    if (!listing) return;
    const parsed = listing.kind === 'part' ? parseQuantity(text, listing.unit?.decimals ?? 0) : parseMachineCount(text);
    if (!parsed.ok) {
      setError(t(`listing.quantitySheet.problem.${parsed.problem}`));
      return;
    }
    if (holds && isBelowHeld(parsed.value, holds)) {
      setError(t('holds.quantityBelowHeld', { held: quantityText(holds.held, listing.unit) }));
      return;
    }
    setError(undefined);
    save.mutate(
      { id: listing.id, quantity: parsed.value },
      {
        onSuccess: (view) => {
          onClose();
          // An unaccepted sanity flag sends a public listing back to review (§7.3): say so.
          const key = quantityToastKey(listing.status, view.status);
          Toast.show({ type: key === 'listing.quantitySheet.saved' ? 'success' : 'info', text1: t(key) });
        },
        onError: (err) => setError(listingWriteErrorMessage(err)),
      },
    );
  };

  const unit = unitLabel(listing?.unit);
  const heldHint = holds?.hasHolds ? t('holds.quantityHint', { held: quantityText(holds.held, listing?.unit) }) : undefined;
  return (
    <ActionSheet
      visible={visible}
      title={t('listing.quantitySheet.title')}
      subtitle={listing?.title}
      items={[]}
      onSelect={() => {}}
      onClose={onClose}
    >
      <Input
        label={unit ? t('listing.quantitySheet.labelUnit', { unit }) : t('listing.quantitySheet.label')}
        value={text}
        onChangeText={(v) => { setText(v); setError(undefined); }}
        keyboardType={listing?.kind === 'part' && (listing.unit?.decimals ?? 0) > 0 ? 'decimal-pad' : 'number-pad'}
        error={error}
        testID="Quantity-input"
      />
      {heldHint && !error ? <FieldHint>{heldHint}</FieldHint> : null}
      <Button title={t('listing.quantitySheet.save')} onPress={submit} loading={save.isPending} phLabel="Quantity-save" />
    </ActionSheet>
  );
}
