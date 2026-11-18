import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { LISTING_REPORT_REASONS, type ListingReportReason } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useReportListing } from '@/hooks/use-listing';
import { listingErrorMessage } from '@/lib/listing-errors';
import { REPORT_DETAILS_MAX, reportBody, reportProblem } from '@/lib/listing-page';

interface ReportSheetProps {
  visible: boolean;
  listingId: string;
  /** The listing's title, under the sheet's title. */
  listingTitle: string;
  onClose: () => void;
}

/**
 * Report listing (F2 spec §8.4, mockup "Report listing"): one reason, optional details (required for Something else,
 * ≤ 500), Send. `409 REPORT_EXISTS` and `429 REPORT_LIMIT` show their own lines. Tracks `listing_reported { reason }`
 * (in `useReportListing`).
 */
export default function ReportSheet({ visible, listingId, listingTitle, onClose }: ReportSheetProps) {
  const { t } = useTranslation();
  const report = useReportListing();
  const [reason, setReason] = useState<ListingReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    setTried(false);
  }, [visible]);

  const problem = reportProblem(reason, details);
  const detailsError = tried && problem === 'detailsRequired'
    ? t('listing.report.detailsRequired')
    : problem === 'detailsTooLong' ? t('listing.report.detailsTooLong') : undefined;

  const send = () => {
    setTried(true);
    if (problem === 'reason') {
      Toast.show({ type: 'error', text1: t('listing.report.reasonRequired') });
      return;
    }
    if (problem || !reason) return;
    report.mutate(
      { id: listingId, body: reportBody(reason, details) },
      {
        onSuccess: () => {
          onClose();
          Toast.show({ type: 'success', text1: t('listing.report.sent') });
        },
        onError: (err) => Toast.show({ type: 'error', text1: listingErrorMessage(err) }),
      },
    );
  };

  return (
    <ActionSheet
      visible={visible}
      title={t('listing.report.title')}
      subtitle={listingTitle}
      items={LISTING_REPORT_REASONS.map((r) => ({
        key: r,
        label: t(`listing.reportReason.${r}`),
        selected: reason === r,
        testID: `Report-reason-${r}`,
      }))}
      onSelect={(key) => setReason(key as ListingReportReason)}
      onClose={onClose}
    >
      <Input
        label={t('listing.report.details')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={REPORT_DETAILS_MAX + 50}
        error={detailsError}
        placeholder={reason === 'something_else' ? t('listing.report.detailsRequired') : t('listing.report.detailsHint')}
        testID="Report-details"
      />
      <Button title={t('listing.report.send')} onPress={send} loading={report.isPending} phLabel="Report-send" />
    </ActionSheet>
  );
}
