import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Notice from '@/components/Notice';
import { useShareContact, useThread } from '@/hooks/use-chat';
import { useType } from '@/hooks/use-type';
import { nextClientMessageId } from '@/lib/chat-composer';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { CircleCheck, Lock } from '@/lib/icons';
import { useTheme } from '@/lib/theme';

/**
 * "Share my number with [business] for this deal" (F6 + F7 spec §6.6): the consent tick, on the Deal record and the
 * thread banner once a deal exists.
 */
export interface ShareNumberSheetProps {
  threadId: string;
  counterpartName: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * The share-my-number consent (§6.6, wording version 1 in three languages, `CONSENT_WORDING_VERSION`): the tick, what it
 * means (the number shows only when both share; text already written becomes readable and can't be taken back), then
 * Share. When the number would be the owner's personal phone and the reader isn't the owner, only the hint shows. Reads
 * the thread's `contact` state (cached by the thread screen; fetched for the Deal record). One Idempotency-Key per
 * opening, reused on a retry.
 */
export default function ShareNumberSheet({ threadId, counterpartName, visible, onClose }: ShareNumberSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const thread = useThread(threadId);
  const share = useShareContact(threadId);
  const [ticked, setTicked] = useState(false);
  const key = useRef<string>(nextClientMessageId());
  const contact = thread.data?.contact;

  useEffect(() => {
    if (!visible) return;
    setTicked(false);
    key.current = nextClientMessageId();
  }, [visible]);

  const s = useMemo(() => StyleSheet.create({
    body: { ...type('body'), color: colors.textSecondary },
    hint: { ...type('caption'), color: colors.textMuted },
  }), [colors, type]);

  const submit = () => {
    if (!ticked) {
      Toast.show({ type: 'info', text1: t('chats.contact.tickFirst') });
      return;
    }
    share.mutate(key.current, {
      onSuccess: (r) => {
        onClose();
        Toast.show({ type: 'success', text1: t(r.revealed ? 'chats.contact.sharedRevealed' : 'chats.contact.shared') });
      },
      onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
    });
  };

  let content: React.ReactNode;
  if (contact?.ownerOnlyHint) {
    content = <Notice tone="info" icon={Lock} text={t('chats.contact.ownerOnly')} />;
  } else if (contact?.mine) {
    content = (
      <Notice
        tone="success"
        icon={CircleCheck}
        text={contact.revealed ? t('chats.contact.revealed') : t('chats.contact.sharedMine', { name: counterpartName })}
      />
    );
  } else {
    content = (
      <>
        <Chip
          label={t('chats.contact.tick', { name: counterpartName })}
          selected={ticked}
          onPress={() => setTicked((v) => !v)}
          role="checkbox"
          testID="Share-number-tick"
        />
        <Text style={s.body}>{t('chats.contact.sheetBody', { name: counterpartName })}</Text>
        <Text style={s.hint}>{t('chats.contact.sheetFallback')}</Text>
        <Button
          title={t('chats.contact.confirm')}
          onPress={submit}
          disabled={!ticked || (contact !== undefined && !contact.canTick)}
          loading={share.isPending}
          phLabel="Share-number-confirm"
        />
      </>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('chats.contact.sheetTitle')} testID="Share-number-backdrop">
      {content}
    </BottomSheet>
  );
}
