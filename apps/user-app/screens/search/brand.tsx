import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import ListRow from '@/components/ListRow';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { useBrandView } from '@/hooks/use-discover';
import { useDiscoveryOrigin } from '@/hooks/use-discovery-origin';
import { useType } from '@/hooks/use-type';
import { ChevronRight, Inbox, TriangleAlert } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import CountPill from './count-pill';

/**
 * The brand view (F4 + F5 spec §7, §8.4): "All <brand>" with `allCount` opens results with the `brandId` filter (the
 * brand chip's meaning); a model row opens results with the fits-machine filter for that model.
 */
export default function SearchBrandScreen({ navigation, route }: RootStackScreenProps<'SearchBrand'>) {
  const { brandId, brandName, kinds, radiusKm } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const origin = useDiscoveryOrigin();
  // Browse's "Show all India" (radiusKm null) wins over the location sheet's radius, here and in the results it opens.
  const viewRadiusKm = radiusKm !== undefined ? radiusKm : origin.radiusKm;
  const listRadius = radiusKm !== undefined ? { radiusKm } : {};
  const view = useBrandView({ brandId, kinds, origin: origin.origin, radiusKm: viewRadiusKm }, origin.ready);
  const name = view.data?.brand.name ?? brandName;

  const s = useMemo(() => StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.md },
    title: { ...type('section'), color: colors.text, marginTop: spacing.sm },
    skeleton: { height: 56, borderRadius: radius.md },
    trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  }), [colors, type]);

  const trailing = (n: number) => (
    <View style={s.trailing}>
      <CountPill count={n} />
      <ChevronRight size={18} color={colors.textMuted} />
    </View>
  );

  let body: React.ReactNode;
  if (!origin.ready || view.isLoading) {
    body = <View style={{ gap: spacing.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (view.isError || !view.data) {
    body = (
      <EmptyState
        icon={TriangleAlert}
        title={t('discover.search.results.loadError')}
        subtitle={t('discover.search.results.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Search-brand-retry"
        onCtaPress={() => void view.refetch()}
      />
    );
  } else {
    const { models, allCount } = view.data;
    body = (
      <>
        <Card flush>
          <ListRow
            label={t('discover.search.brand.all', { name })}
            hint={t('discover.search.brand.allHint')}
            trailing={trailing(allCount)}
            last
            onPress={() => navigation.navigate('SearchResults', { filters: { brandId, ...(kinds?.length ? { kinds } : {}), ...listRadius } })}
            testID="Search-brand-all"
          />
        </Card>
        <Text style={s.title}>{t('discover.search.brand.models')}</Text>
        {models.length > 0 ? (
          <Card flush>
            {models.map((m, i) => (
              <ListRow
                key={m.id}
                label={m.name}
                trailing={trailing(m.liveCount)}
                last={i === models.length - 1}
                onPress={() => navigation.navigate('SearchResults', {
                  filters: { fit: { brandId, modelId: m.id }, ...(kinds?.length ? { kinds } : {}), ...listRadius },
                  fitLabel: `${name} ${m.name}`,
                })}
                testID="Search-brand-model"
              />
            ))}
          </Card>
        ) : (
          <EmptyState icon={Inbox} title={t('discover.search.brand.empty')} subtitle={t('discover.search.brand.emptyBody')} />
        )}
      </>
    );
  }

  return (
    <ScreenWrapper>
      <Header title={name} />
      <ScrollView contentContainerStyle={s.content}>{body}</ScrollView>
    </ScreenWrapper>
  );
}
