import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PART_REQUEST_CLOSE_REASONS, type PartRequestCloseReason } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';

/**
 * Close a requirement (F8 spec §9.1, §13.1 sheets): a reason code (no free text, (my call) 9), then Close. Sellers stop
 * seeing it and pending replies are dropped.
 */
export default function CloseSheet({ visible, busy, onClose, onConfirm }: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: PartRequestCloseReason) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<PartRequestCloseReason | null>(null);
  useEffect(() => { if (visible) setReason(null); }, [visible]);

  return (
    <ActionSheet
      visible={visible}
      title={t('requirements.close.title')}
      subtitle={t('requirements.close.body')}
      items={PART_REQUEST_CLOSE_REASONS.map((r) => ({
        key: r,
        label: t(`requirements.close.reason.${r}`),
        selected: reason === r,
        testID: `Requirement-close-${r}`,
      }))}
      onSelect={(key) => setReason(key as PartRequestCloseReason)}
      onClose={onClose}
    >
      <Button
        title={t('requirements.close.confirm')}
        variant="danger"
        size="md"
        disabled={!reason}
        loading={busy}
        phLabel="Requirement-close-confirm"
        onPress={() => reason && onConfirm(reason)}
      />
    </ActionSheet>
  );
}
