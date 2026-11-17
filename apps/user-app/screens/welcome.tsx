import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Button from '@/components/Button';
import { Package } from '@/lib/icons';
import { fonts, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

export default function WelcomeScreen({ navigation }: RootStackScreenProps<'Welcome'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl },
    mark: {
      width: 72, height: 72, borderRadius: 20, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xxl,
    },
    title: { fontFamily: fonts.displayHeavy, fontSize: 32, lineHeight: 40, color: colors.text },
    subtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.textSecondary, marginTop: spacing.md },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  }), [colors]);

  return (
    <ScreenWrapper>
      <View style={s.body}>
        <View style={s.mark}>
          <Package size={36} color={colors.onPrimary} />
        </View>
        <Text style={s.title}>{t('auth.welcome.title')}</Text>
        <Text style={s.subtitle}>{t('auth.welcome.subtitle')}</Text>
      </View>
      <View style={s.footer}>
        <Button title={t('auth.welcome.cta')} phLabel="Get-started" onPress={() => navigation.navigate('Auth')} />
      </View>
    </ScreenWrapper>
  );
}
