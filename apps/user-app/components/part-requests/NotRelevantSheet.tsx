import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { PART_REQUEST_FEEDBACK_REASONS, type PartRequestFeedbackReason } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import { useNotRelevant } from '@/hooks/use-seller-part-requests';
import { f8ErrorMessage } from '@/lib/f8-errors';

interface NotRelevantSheetProps {
  visible: boolean;
  partRequestId: string;
  /** The request's (masked) name, under the title. */
  requestName: string;
  onClose: () => void;
  onDone?: () => void;
}

/**
 * Not relevant (F8 spec §5.6, R7): an optional reason (don't sell this, too far, wrong category, other), then "Hide
 * it". The request leaves this business's For you and All lists and the reason is kept as targeting feedback; the
 * requirement page offers Undo. Tracks `request_not_relevant { reason }` (in `useNotRelevant`).
 */
export default function NotRelevantSheet({ visible, partRequestId, requestName, onClose, onDone }: NotRelevantSheetProps) {
  const { t } = useTranslation();
  const { set } = useNotRelevant(partRequestId);
  const [reason, setReason] = useState<PartRequestFeedbackReason | null>(null);

  useEffect(() => { if (visible) setReason(null); }, [visible]);

  const send = () => {
    set.mutate(reason, {
      onSuccess: () => {
        onClose();
        Toast.show({ type: 'success', text1: t('buyers.notRelevant.done') });
        onDone?.();
      },
      onError: (err) => Toast.show({ type: 'error', text1: f8ErrorMessage(err) }),
    });
  };

  return (
    <ActionSheet
      visible={visible}
      title={t('buyers.notRelevant.title')}
      subtitle={requestName}
      items={PART_REQUEST_FEEDBACK_REASONS.map((r) => ({
        key: r,
        label: t(`buyers.notRelevant.reason.${r}`),
        selected: reason === r,
        testID: `NotRelevant-reason-${r}`,
      }))}
      onSelect={(key) => setReason((cur) => (cur === key ? null : (key as PartRequestFeedbackReason)))}
      onClose={onClose}
    >
      <Button title={t('buyers.notRelevant.send')} onPress={send} loading={set.isPending} phLabel="NotRelevant-send" />
    </ActionSheet>
  );
}
