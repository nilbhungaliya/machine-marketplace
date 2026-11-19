import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { InboxFilter, InboxRow } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { useOnReconnect } from '@/components/SocketProvider';
import InboxSegments from '@/components/chat/InboxSegments';
import ThreadRow from '@/components/chat/ThreadRow';
import { useThreads } from '@/hooks/use-chat';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useType } from '@/hooks/use-type';
import { askPushOnce } from '@/lib/push-ask';
import { Archive, ChevronRight, TAB_ICONS, TriangleAlert } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

/**
 * The Chats tab (F6 + F7 spec §6.10, §15.1; mockup negotiate · "Enquiries inbox"): segments All / Buying / Selling /
 * Your turn n, rows newest first with infinite scroll, pull to refresh, and an Archived link at the bottom that shows the
 * archived list in place (Back returns to the inbox). Asks for push permission once on focus (§11.6).
 */
export default function ChatsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const tabInset = useTabBarInset();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [archived, setArchived] = useState(false);
  const list = useThreads(archived ? 'all' : filter, archived);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const yourTurn = list.data?.pages[0]?.counts.yourTurn ?? 0;

  const { refetch } = list;
  // Read through a ref so going stale while on screen doesn't refetch by itself (only a return to the tab does).
  const stale = useRef(list.isStale);
  stale.current = list.isStale;
  useFocusEffect(useCallback(() => {
    void askPushOnce('chats');
    if (stale.current) void refetch();
  }, [refetch]));
  useOnReconnect(() => void refetch());
  // Hardware Back leaves the archived list first.
  useFocusEffect(useCallback(() => {
    if (!archived) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setArchived(false); return true; });
    return () => sub.remove();
  }, [archived]));

  const s = useMemo(() => StyleSheet.create({
    segments: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
    list: { paddingHorizontal: spacing.md, paddingBottom: tabInset + spacing.lg, flexGrow: 1 },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden',
    },
    skeleton: { height: 76, borderRadius: radius.lg, marginBottom: spacing.sm },
    archivedLink: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, marginTop: spacing.md,
    },
    archivedText: { ...type('label'), color: colors.primaryInk },
    footer: { paddingVertical: spacing.lg },
  }), [colors, type, tabInset]);

  const open = (row: InboxRow) => navigation.navigate('Thread', { threadId: row.threadId });

  let empty: React.ReactElement;
  if (list.isLoading) {
    empty = <View>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (list.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('chats.loadErrorTitle')}
        subtitle={t('chats.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Chats-retry"
        onCtaPress={() => void refetch()}
      />
    );
  } else if (archived) {
    empty = <EmptyState icon={Archive} title={t('chats.archivedEmptyTitle')} subtitle={t('chats.archivedEmptySubtitle')} />;
  } else if (filter !== 'all') {
    empty = <EmptyState icon={TAB_ICONS.chats} title={t('chats.filterEmptyTitle')} subtitle={t('chats.filterEmptySubtitle')} />;
  } else {
    empty = <EmptyState icon={TAB_ICONS.chats} title={t('chats.emptyTitle')} subtitle={t('chats.emptySubtitle')} />;
  }

  const footer = (
    <View>
      {list.isFetchingNextPage ? <ActivityIndicator style={s.footer} color={colors.primary} /> : null}
      {!archived && !list.isLoading && !list.isError ? (
        <Pressable style={s.archivedLink} onPress={() => setArchived(true)} testID="Chats-archived" accessibilityRole="button">
          <Archive size={16} color={colors.primaryInk} />
          <Text style={s.archivedText}>{t('chats.archivedLink')}</Text>
          <ChevronRight size={16} color={colors.primaryInk} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <ScreenWrapper edges={['top']}>
      {archived ? (
        <Header title={t('chats.archivedTitle')} onBack={() => setArchived(false)} />
      ) : (
        <Header title={t('chats.title')} showBack={false} />
      )}
      {archived ? null : <InboxSegments value={filter} onChange={setFilter} yourTurn={yourTurn} style={s.segments} />}
      <FlatList<InboxRow>
        data={rows}
        keyExtractor={(r) => r.threadId}
        renderItem={({ item, index }) => (
          <View
            style={[
              s.card,
              index > 0 && { borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
              index < rows.length - 1 && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 },
            ]}
          >
            <ThreadRow row={item} onPress={() => open(item)} last={index === rows.length - 1} />
          </View>
        )}
        contentContainerStyle={s.list}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void refetch()}
      />
    </ScreenWrapper>
  );
}
