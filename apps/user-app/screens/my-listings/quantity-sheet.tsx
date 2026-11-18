import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useMutation } from '@tanstack/react-query';
import type { ListingCard } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useStoreOwnerView } from '@/hooks/use-listing';
import { patchListing } from '@/lib/listing-api';
import { listingErrorMessage } from '@/lib/listing-errors';
import { unitLabel } from '@/lib/listing-format';
import { formatQuantity, parseMachineCount, parseQuantity } from '@/lib/quantity';

export type QuantityTarget = Pick<ListingCard, 'id' | 'kind' | 'quantity' | 'unit' | 'title'>;

interface QuantitySheetProps {
  listing: QuantityTarget | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * Update quantity (F2 spec §10): one field, saved with `PATCH /listings/:id { quantity }`. Parts use the unit's
 * decimals; machines and rentals a whole number 1–1000. Zero is refused with "Use Mark sold instead" (R41).
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

  useEffect(() => {
    if (!visible || !listing) return;
    setText(formatQuantity(listing.quantity).replace(/,/g, ''));
    setError(undefined);
  }, [visible, listing]);

  const submit = () => {
    if (!listing) return;
    const parsed = listing.kind === 'part' ? parseQuantity(text, listing.unit?.decimals ?? 0) : parseMachineCount(text);
    if (!parsed.ok) {
      setError(t(`listing.quantitySheet.problem.${parsed.problem}`));
      return;
    }
    setError(undefined);
    save.mutate(
      { id: listing.id, quantity: parsed.value },
      {
        onSuccess: () => {
          onClose();
          Toast.show({ type: 'success', text1: t('listing.quantitySheet.saved') });
        },
        onError: (err) => setError(listingErrorMessage(err)),
      },
    );
  };

  const unit = unitLabel(listing?.unit);
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
      <Button title={t('listing.quantitySheet.save')} onPress={submit} loading={save.isPending} phLabel="Quantity-save" />
    </ActionSheet>
  );
}
