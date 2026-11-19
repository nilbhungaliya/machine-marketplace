import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { DEAL_LIMITS, type PartySide } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useDealWrite } from '@/hooks/use-deals';
import { track } from '@/lib/analytics';
import { DEAL_EVENTS } from '@/lib/analytics-events';
import { cancelReasonsFor } from '@/lib/deal-display';
import { f6ErrorMessage } from '@/lib/f6-errors';

interface CancelSheetProps {
  dealId: string;
  side: PartySide;
  /** `cancel`: before handover, immediate; `request`: after handover, the other side is asked (§9.5). */
  mode: 'cancel' | 'request';
  visible: boolean;
  onClose: () => void;
}

/** Cancel a deal or ask to cancel it (§9.5): a reason from the side's list, and for a cancel an optional note (≤ 300). */
export default function CancelSheet({ dealId, side, mode, visible, onClose }: CancelSheetProps) {
  const { t } = useTranslation();
  const write = useDealWrite(dealId);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setNote('');
    setTried(false);
  }, [visible]);

  const tooLong = [...note.trim()].length > DEAL_LIMITS.cancelNoteMax;

  const submit = () => {
    setTried(true);
    if (!reason || tooLong) {
      if (!reason) Toast.show({ type: 'error', text1: t('deals.cancel.reasonRequired') });
      return;
    }
    const trimmed = note.trim();
    const w = mode === 'cancel'
      ? { action: 'cancel' as const, body: { reason, note: trimmed === '' ? null : trimmed } }
      : { action: 'request_cancel' as const, body: { reason } };
    write.mutate(w, {
      onSuccess: () => {
        if (mode === 'cancel') track(DEAL_EVENTS.cancelled, { side, reason });
        else track(DEAL_EVENTS.cancelRequested, { side, reason });
        Toast.show({ type: 'success', text1: t(mode === 'cancel' ? 'deals.cancel.done' : 'deals.cancel.requested') });
        onClose();
      },
      onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
    });
  };

  return (
    <ActionSheet
      visible={visible}
      title={t(mode === 'cancel' ? 'deals.cancel.title' : 'deals.cancel.requestTitle')}
      subtitle={t(mode === 'cancel' ? 'deals.cancel.body' : 'deals.cancel.requestBody')}
      items={cancelReasonsFor(side).map((r) => ({
        key: r,
        label: t(`deals.cancelReason.${r}`),
        selected: reason === r,
        testID: `Deal-cancel-reason-${r}`,
      }))}
      onSelect={setReason}
      onClose={onClose}
    >
      {mode === 'cancel' ? (
        <Input
          label={t('deals.cancel.note')}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={t('offers.sheet.noteHint')}
          error={tried && tooLong ? t('deals.cancel.noteError', { max: DEAL_LIMITS.cancelNoteMax }) : undefined}
          testID="Deal-cancel-note"
        />
      ) : null}
      <Button
        title={t(mode === 'cancel' ? 'deals.cancel.confirm' : 'deals.cancel.requestConfirm')}
        onPress={submit}
        variant="danger"
        loading={write.isPending}
        phLabel={mode === 'cancel' ? 'Deal-cancel-confirm' : 'Deal-cancel-request-confirm'}
      />
    </ActionSheet>
  );
}
