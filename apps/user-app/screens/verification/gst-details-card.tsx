import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { GstDetails } from '@mpm/shared-types';
import Card from '@/components/Card';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { formatDate } from '@/lib/format-date';
import { constitutionKey } from '@/lib/gst-flow';
import { Check } from '@/lib/icons';
import { splitOnValue } from '@/lib/split-value';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { TypeToken } from '@/lib/typography';

/**
 * "GSTIN {{gstin}}" with the GSTIN alone as a JetBrains Mono tag (spec §5.2, the mockup's `.pn`): the translated
 * sentence is split around the value, so the copy doesn't change. Falls back to the plain sentence.
 */
export function GstinLine({ gstin, token = 'caption', center = false, style }: {
  gstin: string;
  /** The surrounding text's type; the tag is 0.9 × its size. */
  token?: Extract<TypeToken, 'caption' | 'body'>;
  center?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const text = t('verification.details.gstin', { gstin });
  const parts = splitOnValue(text, gstin);
  const s = useMemo(() => {
    const around = type(token);
    const size = Math.round(around.fontSize * 0.9);
    return StyleSheet.create({
      row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: center ? 'center' : 'flex-start' },
      text: { ...around, color: colors.textSecondary, textAlign: center ? 'center' : 'left' },
      tag: { backgroundColor: colors.field, borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 1 },
      mono: { ...type('mono'), fontSize: size, lineHeight: Math.round(size * 1.4), color: colors.text },
    });
  }, [colors, type, token, center]);

  if (!parts) return <View style={style}><Text style={s.text}>{text}</Text></View>;
  return (
    <View style={[s.row, style]} accessible accessibilityLabel={text}>
      {parts[0] ? <Text style={s.text}>{parts[0]}</Text> : null}
      <View style={s.tag}><Text style={s.mono}>{parts[1]}</Text></View>
      {parts[2] ? <Text style={s.text}>{parts[2]}</Text> : null}
    </View>
  );
}

/** The registration a lookup found (or was verified with): v2 `.gstcard`. Names and address are GST's text. */
export default function GstDetailsCard({ details, gstin, style }: { details?: GstDetails; gstin?: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.xs },
    name: { ...type('cardTitle'), color: colors.text },
    line: { ...type('caption'), color: colors.textSecondary },
    gstin: { marginTop: spacing.xs },
    badge: { marginTop: spacing.sm },
  }), [colors, type]);

  // Officer-approved details carry a constitution key; a provider's lookup carries its own text.
  const constitutionTKey = details ? constitutionKey(details.constitution) : null;
  const constitution = constitutionTKey ? t(constitutionTKey) : (details?.constitution ?? '');
  const registered = details?.registeredOn ? Date.parse(details.registeredOn) : NaN;
  const address = details ? [details.address.line, details.address.city, details.address.state, details.address.pincode].filter(Boolean).join(', ') : '';

  return (
    <Card style={[s.card, style]}>
      {details ? <Text style={s.name}>{details.legalName}</Text> : null}
      {details?.tradeName && details.tradeName !== details.legalName ? (
        <Text style={s.line}>{t('verification.details.tradeName', { name: details.tradeName })}</Text>
      ) : null}
      {details ? (
        <Text style={s.line}>
          {constitution}
          {Number.isNaN(registered) ? '' : ` · ${t('verification.details.registeredOn', { date: formatDate(registered) })}`}
        </Text>
      ) : null}
      {address ? <Text style={s.line}>{address}</Text> : null}
      {gstin ? <GstinLine gstin={gstin} style={s.gstin} /> : null}
      {details?.status === 'active' ? (
        <StatusChip tone="ok" icon={Check} label={t('verification.details.active')} style={s.badge} />
      ) : null}
    </Card>
  );
}
