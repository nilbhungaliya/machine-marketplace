import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { PART_REQUEST_LIMITS, PART_REQUEST_REPORT_REASONS, type PartRequestReportReason } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useReportPartRequest } from '@/hooks/use-seller-part-requests';
import { f8ErrorMessage } from '@/lib/f8-errors';

interface RequestReportSheetProps {
  visible: boolean;
  partRequestId: string;
  requestName: string;
  onClose: () => void;
}

/**
 * Report a requirement (F8 spec §14, §15): one reason (spam, fake, contact details, prohibited, other), details
 * (required for Other, ≤ 500), Send. `409 REPORT_EXISTS` and `429 REPORT_LIMIT` show their own lines. Tracks
 * `request_reported { reason }` (in `useReportPartRequest`); the details never go to analytics.
 */
export default function RequestReportSheet({ visible, partRequestId, requestName, onClose }: RequestReportSheetProps) {
  const { t } = useTranslation();
  const report = useReportPartRequest(partRequestId);
  const [reason, setReason] = useState<PartRequestReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    setTried(false);
  }, [visible]);

  const trimmed = details.trim();
  const tooLong = trimmed.length > PART_REQUEST_LIMITS.noteMax;
  const needsDetails = reason === 'other' && trimmed === '';
  const detailsError = tooLong
    ? t('buyers.report.detailsTooLong', { max: PART_REQUEST_LIMITS.noteMax })
    : tried && needsDetails ? t('buyers.report.detailsRequired') : undefined;

  const send = () => {
    setTried(true);
    if (!reason) {
      Toast.show({ type: 'error', text1: t('buyers.report.reasonRequired') });
      return;
    }
    if (needsDetails || tooLong) return;
    report.mutate(
      { reason, details: trimmed || null },
      {
        onSuccess: () => {
          onClose();
          Toast.show({ type: 'success', text1: t('buyers.report.sent') });
        },
        onError: (err) => Toast.show({ type: 'error', text1: f8ErrorMessage(err) }),
      },
    );
  };

  return (
    <ActionSheet
      visible={visible}
      title={t('buyers.report.title')}
      subtitle={requestName}
      items={PART_REQUEST_REPORT_REASONS.map((r) => ({
        key: r,
        label: t(`buyers.report.reason.${r}`),
        selected: reason === r,
        testID: `RequestReport-reason-${r}`,
      }))}
      onSelect={(key) => setReason(key as PartRequestReportReason)}
      onClose={onClose}
    >
      <Input
        label={t('buyers.report.details')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={PART_REQUEST_LIMITS.noteMax + 50}
        error={detailsError}
        placeholder={reason === 'other' ? t('buyers.report.detailsRequired') : t('buyers.report.detailsHint')}
        testID="RequestReport-details"
      />
      <Button title={t('buyers.report.send')} onPress={send} loading={report.isPending} phLabel="RequestReport-send" />
    </ActionSheet>
  );
}
