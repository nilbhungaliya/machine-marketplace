import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEAL_LIMITS } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';

interface RejectOfferSheetProps {
  visible: boolean;
  loading?: boolean;
  onClose: () => void;
  /** The optional reason (≤ 300, trimmed, empty → null). */
  onReject: (note: string | null) => void;
}

/** Reject an offer with an optional reason (F6 + F7 spec §7.5: note ≤ 300, masked to the other side). */
export default function RejectOfferSheet({ visible, loading, onClose, onReject }: RejectOfferSheetProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  useEffect(() => { if (visible) setNote(''); }, [visible]);
  const tooLong = [...note.trim()].length > DEAL_LIMITS.rejectNoteMax;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('offers.actions.rejectTitle')} testID="Offer-reject-backdrop">
      <Input
        label={t('offers.actions.rejectNote')}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={t('offers.sheet.noteHint')}
        error={tooLong ? t('offers.error.rejectNoteTooLong', { max: DEAL_LIMITS.rejectNoteMax }) : undefined}
        testID="Offer-reject-note"
      />
      <Button
        title={t('offers.actions.rejectConfirm')}
        variant="danger"
        onPress={() => { if (!tooLong) onReject(note.trim() === '' ? null : note.trim()); }}
        loading={loading}
        phLabel="Offer-reject-confirm"
      />
    </BottomSheet>
  );
}
