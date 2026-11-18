import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { GstDetails } from '@mpm/shared-types';
import { formatDate } from '@/lib/format-date';
import { constitutionKey } from '@/lib/gst-flow';
import { CircleCheck } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

/** The registration a lookup found (or was verified with): v2 "GST verification" card. Names and address are GST's text. */
export default function GstDetailsCard({ details, gstin, style }: { details?: GstDetails; gstin?: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    card: {
      padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.card, gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    name: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
    line: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    gstin: { fontFamily: fonts.semiBold, fontSize: 14, letterSpacing: 1, color: colors.text, marginTop: spacing.xs },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm,
      paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.greenMuted,
    },
    badgeText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.green },
  }), [colors]);

  // Officer-approved details carry a constitution key; a provider's lookup carries its own text.
  const constitutionTKey = details ? constitutionKey(details.constitution) : null;
  const constitution = constitutionTKey ? t(constitutionTKey) : (details?.constitution ?? '');
  const registered = details?.registeredOn ? Date.parse(details.registeredOn) : NaN;
  const address = details ? [details.address.line, details.address.city, details.address.state, details.address.pincode].filter(Boolean).join(', ') : '';

  return (
    <View style={[s.card, style]}>
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
      {gstin ? <Text style={s.gstin}>{t('verification.details.gstin', { gstin })}</Text> : null}
      {details?.status === 'active' ? (
        <View style={s.badge}>
          <CircleCheck size={14} color={colors.green} />
          <Text style={s.badgeText}>{t('verification.details.active')}</Text>
        </View>
      ) : null}
    </View>
  );
}
