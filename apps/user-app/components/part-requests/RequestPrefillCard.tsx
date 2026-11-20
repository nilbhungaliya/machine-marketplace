import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PartRequestPrefill } from '@mpm/shared-types';
import Button from '@/components/Button';
import { usePartRequestOptions } from '@/hooks/use-part-request';
import { useRequireSignIn } from '@/hooks/use-require-sign-in';
import { useType } from '@/hooks/use-type';
import { ClipboardList } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

/**
 * "Post a requirement" from No results (F8 spec §13.1, R15): "Can't find it? Tell up to {n} sellers", opening the form
 * filled from what was searched. A guest gets the sign-in sheet and the form opens after sign-in and onboarding
 * (`post_request` pending action). The form never posts by itself.
 */
export default function RequestPrefillCard({ prefill, style }: { prefill: PartRequestPrefill; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { requireSignIn } = useRequireSignIn();
  const options = usePartRequestOptions();

  const s = useMemo(() => StyleSheet.create({
    box: {
      gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primaryWash,
      borderWidth: 1, borderColor: colors.primarySoft,
    },
    head: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    well: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    text: { flex: 1, gap: 2 },
    title: { ...type('bodyStrong'), color: colors.text },
    body: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const open = () => {
    if (!requireSignIn({ reason: 'request', pending: { type: 'post_request', prefill } })) return;
    navigation.navigate('PostRequirement', { prefill });
  };

  return (
    <View style={[s.box, style]} testID="Request-prefill-card">
      <View style={s.head}>
        <View style={s.well}><ClipboardList size={20} color={colors.primaryInk} /></View>
        <View style={s.text}>
          <Text style={s.title}>{t('requirements.prefill.title')}</Text>
          <Text style={s.body}>{t('requirements.prefill.body', { n: options.data?.reachN ?? 15 })}</Text>
        </View>
      </View>
      <Button title={t('requirements.prefill.cta')} size="md" phLabel="Request-prefill-post" onPress={open} />
    </View>
  );
}
