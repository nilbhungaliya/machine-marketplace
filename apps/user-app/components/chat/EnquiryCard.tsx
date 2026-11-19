import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ThreadMessage } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { formatTime } from '@/lib/format-date';
import { formatQuantity } from '@/lib/quantity';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

interface EnquiryCardProps {
  message: ThreadMessage;
  /** The listing's unit label ("pc"), for "Best price for 2 pc". */
  unitLabel: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * An enquiry card in the thread (§6.3): the quick questions as chips, the quantity for Best price / Price please, the
 * note (masked per reader by the server), and the buyer's machine resolved by the server with its fit verdict.
 */
export default function EnquiryCard({ message, unitLabel, style }: EnquiryCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const enquiry = message.enquiry;
  const mine = message.isMine;

  const s = useMemo(() => StyleSheet.create({
    card: {
      width: '88%', borderRadius: radius.lg + 2, borderWidth: 1.5, backgroundColor: colors.surface, overflow: 'hidden',
    },
    cardMine: { alignSelf: 'flex-end', borderColor: colors.primary },
    cardTheirs: { alignSelf: 'flex-start', borderColor: colors.primarySoft },
    head: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.primaryWash },
    title: { ...type('label'), fontFamily: fonts.extraBold, color: colors.text },
    body: { padding: spacing.md, gap: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
    chip: { borderRadius: radius.full, backgroundColor: colors.primarySoft, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1 },
    chipText: { ...type('chip'), color: colors.primaryInk },
    line: { ...type('caption'), color: colors.textSecondary },
    note: { ...type('body'), color: colors.text },
    time: { ...type('caption'), color: colors.textMuted, alignSelf: 'flex-end' },
  }), [colors, type]);

  if (!enquiry) return null;
  const machine = enquiry.machine;
  const machineName = machine
    ? [machine.brandName, machine.modelName, machine.year != null ? String(machine.year) : null].filter(Boolean).join(' ')
    : null;

  return (
    <View style={[s.card, mine ? s.cardMine : s.cardTheirs, style]} testID={`Thread-enquiry-${message.seq}`}>
      <View style={s.head}>
        <Text style={s.title}>{t(mine ? 'chats.enquiryCard.mine' : 'chats.enquiryCard.theirs')}</Text>
      </View>
      <View style={s.body}>
        {enquiry.quick.length > 0 ? (
          <View style={s.chips}>
            {enquiry.quick.map((q) => (
              <View key={q} style={s.chip}><Text style={s.chipText}>{t(`chats.quick.${q}`)}</Text></View>
            ))}
          </View>
        ) : null}
        {enquiry.quantity ? (
          <Text style={s.line}>
            {t('chats.enquiryCard.quantity', { quantity: unitLabel ? `${formatQuantity(enquiry.quantity)} ${unitLabel}` : formatQuantity(enquiry.quantity) })}
          </Text>
        ) : null}
        {machine && machineName ? (
          <Text style={s.line}>
            {t('chats.enquiryCard.machine', { machine: machineName })}
            {' · '}
            {t(machine.verdict === 'fits' ? 'chats.enquiryCard.fits' : 'chats.enquiryCard.notListed')}
          </Text>
        ) : null}
        {enquiry.note ? <Text style={s.note} selectable>{enquiry.note}</Text> : null}
        <Text style={s.time}>{formatTime(Date.parse(message.createdAt))}</Text>
      </View>
    </View>
  );
}
