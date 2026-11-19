import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { CHAT_LIMITS, CONVERSATION_REPORT_REASONS, type ConversationReportReason } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Input from '@/components/Input';
import { useReportThread } from '@/hooks/use-chat';
import { f6ErrorMessage } from '@/lib/f6-errors';

interface ReportConversationSheetProps {
  visible: boolean;
  threadId: string;
  counterpartName: string;
  /** Offer "Also block" (not when this business already blocked the other). */
  canBlock: boolean;
  onClose: () => void;
}

/**
 * Report a conversation (§6.12): one reason, details (required for Something else, ≤ 500), and "Also block" in the same
 * sheet. `409 REPORT_EXISTS` and `429 REPORT_LIMIT` show their own lines. Tracks the reason code only.
 */
export default function ReportConversationSheet({ visible, threadId, counterpartName, canBlock, onClose }: ReportConversationSheetProps) {
  const { t } = useTranslation();
  const report = useReportThread(threadId);
  const [reason, setReason] = useState<ConversationReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    setBlock(false);
    setTried(false);
  }, [visible]);

  const text = details.trim();
  const tooLong = text.length > CHAT_LIMITS.reportDetailsMax;
  const needsDetails = reason === 'other' && text === '';
  const detailsError = tooLong
    ? t('chats.report.detailsTooLong')
    : tried && needsDetails ? t('chats.report.detailsRequired') : undefined;

  const send = () => {
    setTried(true);
    if (!reason) {
      Toast.show({ type: 'error', text1: t('chats.report.reasonRequired') });
      return;
    }
    if (tooLong || needsDetails) return;
    report.mutate(
      { reason, details: text === '' ? null : text, block: canBlock && block },
      {
        onSuccess: () => {
          onClose();
          Toast.show({ type: 'success', text1: t('chats.report.sent') });
        },
        onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
      },
    );
  };

  return (
    <ActionSheet
      visible={visible}
      title={t('chats.report.title')}
      subtitle={counterpartName}
      items={CONVERSATION_REPORT_REASONS.map((r) => ({
        key: r,
        label: t(`chats.report.reason.${r}`),
        selected: reason === r,
        testID: `Report-conversation-reason-${r}`,
      }))}
      onSelect={(key) => setReason(key as ConversationReportReason)}
      onClose={onClose}
    >
      <Input
        label={t('chats.report.details')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={CHAT_LIMITS.reportDetailsMax + 50}
        error={detailsError}
        placeholder={reason === 'other' ? t('chats.report.detailsRequired') : t('chats.report.detailsHint')}
        testID="Report-conversation-details"
      />
      {canBlock ? (
        <Chip
          label={t('chats.report.alsoBlock')}
          selected={block}
          onPress={() => setBlock((b) => !b)}
          role="checkbox"
          testID="Report-conversation-also-block"
        />
      ) : null}
      <Button title={t('chats.report.send')} onPress={send} loading={report.isPending} phLabel="Report-conversation-send" />
    </ActionSheet>
  );
}
