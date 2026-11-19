import React, { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContactState } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ShareNumberSheet from '@/components/contact/ShareNumberSheet';
import { useType } from '@/hooks/use-type';
import { CircleCheck, ShieldCheck } from '@/lib/icons';
import { spacing, useTheme } from '@/lib/theme';

interface ContactBlockProps {
  threadId: string;
  counterpartName: string;
  contact: ContactState;
  /** The server offers the tick (`share_contact` in the deal's actions). */
  canShare: boolean;
  /** After the consent sheet closes (the record refetches: the tick may have landed). */
  onShareClosed?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Deal record's contact block (§6.6, §9.1): numbers stay masked until both sides tick "Share my number" for this
 * deal; then the other side's number shows with a call button. The tick opens L6's consent sheet.
 */
export default function ContactBlock({ threadId, counterpartName, contact, canShare, onShareClosed, style }: ContactBlockProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [sharing, setSharing] = useState(false);
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.sm },
    title: { ...type('section'), color: colors.text },
    body: { ...type('body'), color: colors.textSecondary },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    lineText: { ...type('label'), color: colors.text },
    number: { ...type('phone'), color: colors.text },
    actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  }), [colors, type]);

  const status = contact.number
    ? null
    : contact.mine && !contact.theirs ? t('deals.contact.waitingForThem', { name: counterpartName })
      : contact.theirs && !contact.mine ? t('deals.contact.theyShared', { name: counterpartName })
        : t('deals.contact.hidden');

  return (
    <Card style={[s.card, style]}>
      <Text style={s.title}>{t('deals.contact.title')}</Text>
      {contact.number ? (
        <>
          <Text style={s.number} testID="Deal-contact-number">{contact.number}</Text>
          <View style={s.actions}>
            <Button
              title={t('deals.contact.call')}
              onPress={() => void Linking.openURL(`tel:${contact.number}`)}
              size="sm"
              phLabel="Deal-contact-call"
            />
          </View>
        </>
      ) : (
        <Text style={s.body}>{status}</Text>
      )}
      {contact.mine ? (
        <View style={s.line}>
          <CircleCheck size={16} color={colors.ok} />
          <Text style={s.lineText}>{t('deals.contact.youShared')}</Text>
        </View>
      ) : canShare && contact.canTick ? (
        <Button
          title={t('deals.contact.share')}
          onPress={() => setSharing(true)}
          variant="outline"
          size="sm"
          icon={ShieldCheck}
          phLabel="Deal-contact-share"
          style={{ alignSelf: 'flex-start' }}
        />
      ) : contact.ownerOnlyHint ? (
        <Text style={s.body}>{t('deals.contact.ownerOnly')}</Text>
      ) : null}
      <ShareNumberSheet threadId={threadId} counterpartName={counterpartName} visible={sharing} onClose={() => { setSharing(false); onShareClosed?.(); }} />
    </Card>
  );
}
