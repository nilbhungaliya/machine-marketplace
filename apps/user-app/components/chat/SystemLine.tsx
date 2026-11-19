import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartySide, ThreadMessage } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { renderSystemLine, systemLineParams } from '@/lib/chat-format';
import { radius, spacing, useTheme } from '@/lib/theme';

interface SystemLineProps {
  system: NonNullable<ThreadMessage['system']>;
  mySide: PartySide;
  /** The other business (masked by the server). */
  counterpartName: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A system line (mockup `.sys`, §6.9): stored as a code and values, rendered here in the reader's language. Support's
 * resolution message is the one free text, shown as written under the line.
 */
export default function SystemLine({ system, mySide, counterpartName, style }: SystemLineProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const copy = systemLineParams(system.code, system.values, { mySide, counterpartName });

  const s = useMemo(() => StyleSheet.create({
    wrap: { alignSelf: 'center', maxWidth: '90%', alignItems: 'center', gap: spacing.xs },
    pill: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.full,
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1,
    },
    text: { ...type('caption'), color: colors.textSecondary, textAlign: 'center' },
    support: { ...type('caption'), color: colors.textMuted, textAlign: 'center' },
  }), [colors, type]);

  return (
    <View style={[s.wrap, style]}>
      <View style={s.pill}>
        <Text style={s.text}>{renderSystemLine(copy, t)}</Text>
      </View>
      {copy.supportMessage ? <Text style={s.support}>{t('chats.system.supportMessage', { message: copy.supportMessage })}</Text> : null}
    </View>
  );
}
