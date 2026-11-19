import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContactState } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useType } from '@/hooks/use-type';
import { CircleCheck, Lock, Phone } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface ContactBannerProps {
  contact: ContactState;
  counterpartName: string;
  /** Opens `ShareNumberSheet`. */
  onShare: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The share-my-number banner in a thread with a deal (§6.6, review change 12): asks to share, says who has shared,
 * the owner-only hint for other members on the owner-phone fallback, and the other side's number once revealed (shown
 * only while their consent is valid; the API sends `number` then, never to a viewer).
 */
export default function ContactBanner({ contact, counterpartName, onShare, style }: ContactBannerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    box: {
      marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, gap: spacing.sm,
      borderRadius: radius.lg, backgroundColor: colors.primaryWash, borderWidth: 1, borderColor: colors.primarySoft,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { ...type('bodyStrong'), color: colors.text, flex: 1 },
    body: { ...type('caption'), color: colors.textSecondary, flex: 1 },
    number: { ...type('mono'), color: colors.text },
  }), [colors, type]);

  if (contact.revealed && contact.number) {
    return (
      <View style={[s.box, style]} testID="Thread-contact-revealed">
        <View style={s.row}>
          <Phone size={16} color={colors.ok} />
          <Text style={s.body}>{t('chats.contact.revealedNumber', { name: counterpartName })}</Text>
        </View>
        <Text style={s.number} selectable>{contact.number}</Text>
      </View>
    );
  }
  if (contact.ownerOnlyHint && !contact.mine) {
    return (
      <View style={[s.box, s.row, style]} testID="Thread-contact-owner-only">
        <Lock size={16} color={colors.textSecondary} />
        <Text style={s.body}>{t('chats.contact.ownerOnly')}</Text>
      </View>
    );
  }
  if (contact.mine) {
    return (
      <View style={[s.box, s.row, style]} testID="Thread-contact-mine">
        <CircleCheck size={16} color={colors.ok} />
        <Text style={s.body}>
          {contact.theirs || contact.revealed ? t('chats.contact.revealed') : t('chats.contact.sharedMine', { name: counterpartName })}
        </Text>
      </View>
    );
  }
  if (!contact.canTick) return null;
  return (
    <View style={[s.box, style]} testID="Thread-contact-banner">
      <Text style={s.title}>{contact.theirs ? t('chats.contact.theirsShared', { name: counterpartName }) : t('chats.contact.bannerTitle')}</Text>
      {contact.theirs ? null : <Text style={s.body}>{t('chats.contact.bannerBody', { name: counterpartName })}</Text>}
      <Button title={t('chats.contact.share')} size="sm" variant="outline" icon={Phone} onPress={onShare} phLabel="Thread-share-number" />
    </View>
  );
}
