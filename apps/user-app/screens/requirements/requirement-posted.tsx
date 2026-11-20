import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Button from '@/components/Button';
import Card from '@/components/Card';
import FooterBar from '@/components/FooterBar';
import ListRow from '@/components/ListRow';
import ScreenWrapper from '@/components/ScreenWrapper';
import { usePartRequest, usePartRequestOptions } from '@/hooks/use-part-request';
import { useType } from '@/hooks/use-type';
import { BellRing, CircleCheck, Package } from '@/lib/icons';
import { spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** After the first work-job tick (every 10 s) has targeted sellers and stored the at-post matches (plan B2-2). */
const BACKFILL_REFETCH_MS = 12_000;

/**
 * Requirement posted (F8 spec §13.1): "We're telling up to {n} sellers now" and "{k} listings already match" — the
 * at-post backfill runs in the work job just after posting, so the count is read again once after about 12 s. Links
 * to the requirement (its Auto matches tab when there are some).
 */
export default function RequirementPostedScreen({ navigation, route }: RootStackScreenProps<'RequirementPosted'>) {
  const { partRequestId, backfill } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const options = usePartRequestOptions();
  const request = usePartRequest(partRequestId);
  const [checked, setChecked] = useState(backfill > 0);

  useEffect(() => {
    if (checked) return;
    const timer = setTimeout(() => {
      void request.refetch().finally(() => setChecked(true));
    }, BACKFILL_REFETCH_MS);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const view = request.data?.role === 'buyer' ? request.data : null;
  const matches = Math.max(backfill, view?.counts.matches ?? 0);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' },
    hero: { alignItems: 'center', gap: spacing.md },
    well: {
      width: 72, height: 72, borderRadius: 36, backgroundColor: colors.okSoft, alignItems: 'center', justifyContent: 'center',
    },
    title: { ...type('title'), color: colors.text, textAlign: 'center' },
    lead: { ...type('lead'), color: colors.textSecondary, textAlign: 'center' },
    checking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    checkingText: { ...type('body'), color: colors.textSecondary, flex: 1 },
  }), [colors, type]);

  return (
    <ScreenWrapper>
      <View style={s.body} testID="RequirementPosted-screen">
        <View style={s.hero}>
          <View style={s.well}><CircleCheck size={36} color={colors.ok} /></View>
          <Text style={s.title}>{t('requirements.posted.title')}</Text>
          <Text style={s.lead}>{t('requirements.posted.telling', { n: options.data?.reachN ?? 15 })}</Text>
        </View>
        <Card flush>
          {matches > 0 ? (
            <ListRow
              icon={Package}
              label={t('requirements.posted.matching', { count: matches })}
              hint={t('requirements.posted.matchingHint')}
              chevron
              last
              onPress={() => navigation.replace('Requirement', { partRequestId, tab: 'matches' })}
              testID="RequirementPosted-matches"
            />
          ) : !checked ? (
            <View style={s.checking}>
              <ActivityIndicator color={colors.primary} />
              <Text style={s.checkingText}>{t('requirements.posted.checking')}</Text>
            </View>
          ) : (
            <ListRow icon={BellRing} label={t('requirements.posted.noMatches')} last />
          )}
        </Card>
      </View>
      <FooterBar>
        <Button title={t('requirements.posted.done')} phLabel="RequirementPosted-done" variant="outline" size="md" onPress={() => navigation.goBack()} />
        <Button
          title={t('requirements.posted.view')}
          phLabel="RequirementPosted-view"
          size="md"
          onPress={() => navigation.replace('Requirement', { partRequestId })}
        />
      </FooterBar>
    </ScreenWrapper>
  );
}
