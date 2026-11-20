import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyPartRequestRow, MyPartRequestTab } from '@mpm/shared-types';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import ScreenWrapper from '@/components/ScreenWrapper';
import SegmentedControl from '@/components/SegmentedControl';
import SideToken from '@/components/SideToken';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { useMyPartRequests } from '@/hooks/use-my-part-requests';
import { useType } from '@/hooks/use-type';
import { ChevronRight, ClipboardList, Package, TriangleAlert } from '@/lib/icons';
import { requestStatusKey, requestStatusTone } from '@/lib/part-request-display';
import { formatQuantity } from '@/lib/quantity';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** The row's response line: "3 replies, 2 matches", "1 reply", "Waiting for replies". */
function responsesText(t: (k: string, o?: Record<string, unknown>) => string, r: Pick<MyPartRequestRow, 'replyCount' | 'matchCount'>): string {
  const parts: string[] = [];
  if (r.replyCount > 0) parts.push(t('requirements.mine.replies', { count: r.replyCount }));
  if (r.matchCount > 0) parts.push(t('requirements.mine.matches', { count: r.matchCount }));
  if (parts.length === 0) return t('requirements.mine.waiting');
  return parts.length === 2 ? t('requirements.mine.repliesAndMatches', { replies: parts[0], matches: parts[1] }) : parts[0]!;
}

/**
 * My requirements (F8 spec §13.1, mockup "My requirements"): segments Active n / Fulfilled n / Closed (closed, expired
 * and removed), rows with the side wanted (or a part well), name, quantity + first fit, and the responses line; "+ New";
 * an empty state with Post.
 */
export default function MyRequirementsScreen({ navigation }: RootStackScreenProps<'MyRequirements'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [tab, setTab] = useState<MyPartRequestTab>('active');
  const list = useMyPartRequests(tab);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts;

  const s = useMemo(() => StyleSheet.create({
    seg: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 72,
      backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline,
    },
    well: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.photo, alignItems: 'center', justifyContent: 'center' },
    text: { flex: 1, gap: 2 },
    name: { ...type('cardTitle'), color: colors.text },
    sub: { ...type('caption'), color: colors.textMuted },
    responses: { ...type('label'), color: colors.textSecondary },
    responsesOn: { color: colors.primaryInk },
    meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    skeleton: { height: 72, borderRadius: radius.xl },
    footer: { paddingVertical: spacing.lg },
  }), [colors, type]);

  const renderRow = ({ item }: { item: MyPartRequestRow }) => {
    const sideKind = item.side === 'left' ? 'want-left' : item.side === 'right' ? 'want-right' : item.side === 'pair' ? 'pair' : null;
    const qty = item.kind === 'part' ? `${formatQuantity(item.quantity)} ${item.unitLabel}` : null;
    const sub = [qty, item.firstFit].filter(Boolean).join(', ');
    const any = item.replyCount + item.matchCount > 0;
    return (
      <Pressable
        style={s.row}
        onPress={() => navigation.navigate('Requirement', { partRequestId: item.id })}
        testID="MyRequirements-row"
        accessibilityRole="button"
      >
        {sideKind ? <SideToken kind={sideKind} size="lg" /> : <View style={s.well}><Package size={22} color={colors.textMuted} /></View>}
        <View style={s.text}>
          <Text style={s.name} numberOfLines={2}>{item.name}</Text>
          {sub ? <Text style={s.sub} numberOfLines={1}>{sub}</Text> : null}
          <View style={s.meta}>
            <Text style={[s.responses, any && s.responsesOn]}>{responsesText(t, item)}</Text>
            {item.newCount > 0 ? <StatusChip tone="new" label={t('requirements.mine.newCount', { count: item.newCount })} /> : null}
            {item.status !== 'active' ? <StatusChip tone={requestStatusTone(item.status)} label={t(requestStatusKey(item.status))} /> : null}
          </View>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </Pressable>
    );
  };

  let empty: React.ReactElement;
  if (list.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (list.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('requirements.mine.loadError')}
        subtitle={t('requirements.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="MyRequirements-retry"
        onCtaPress={() => void list.refetch()}
      />
    );
  } else {
    empty = (
      <EmptyState
        icon={ClipboardList}
        title={t(`requirements.mine.empty.${tab}`)}
        subtitle={t('requirements.mine.emptyBody')}
        ctaTitle={tab === 'active' ? t('requirements.mine.post') : undefined}
        ctaPhLabel="MyRequirements-post"
        onCtaPress={tab === 'active' ? () => navigation.navigate('PostRequirement', { prefill: { source: 'post_tab' } }) : undefined}
      />
    );
  }

  return (
    <ScreenWrapper>
      <Header
        title={t('requirements.mine.title')}
        rightIcon={(
          <Button
            title={t('requirements.mine.new')}
            variant="ghost"
            size="sm"
            phLabel="MyRequirements-new"
            onPress={() => navigation.navigate('PostRequirement', { prefill: { source: 'post_tab' } })}
          />
        )}
      />
      <SegmentedControl<MyPartRequestTab>
        style={s.seg}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: t('requirements.mine.tabActive', { count: counts?.active ?? 0 }), testID: 'MyRequirements-tab-active' },
          { value: 'fulfilled', label: t('requirements.mine.tabFulfilled', { count: counts?.fulfilled ?? 0 }), testID: 'MyRequirements-tab-fulfilled' },
          { value: 'closed', label: t('requirements.mine.tabClosed'), testID: 'MyRequirements-tab-closed' },
        ]}
      />
      <FlatList<MyPartRequestRow>
        data={items}
        keyExtractor={(r) => r.id}
        renderItem={renderRow}
        contentContainerStyle={s.list}
        ListEmptyComponent={empty}
        ListFooterComponent={list.isFetchingNextPage ? <View style={s.footer}><ActivityIndicator color={colors.primary} /></View> : null}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
      />
    </ScreenWrapper>
  );
}
