import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { BlockedBusinessItem } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { useBlocks, useUnblock } from '@/hooks/use-chat';
import { useType } from '@/hooks/use-type';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { formatDate } from '@/lib/format-date';
import { Ban, TriangleAlert } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * Profile › Blocked businesses (F6 + F7 spec §6.11): the businesses this one blocked (names masked by the server), when,
 * and Unblock with a confirm. Unblocking reopens writing; closed offers stay closed.
 */
export default function BlockedBusinessesScreen(_props: RootStackScreenProps<'BlockedBusinesses'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const confirm = useConfirm();
  const blocks = useBlocks();
  const unblock = useUnblock();

  const s = useMemo(() => StyleSheet.create({
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, flexGrow: 1 },
    subtitle: { ...type('caption'), color: colors.textSecondary, marginBottom: spacing.sm },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    name: { ...type('cardTitle'), color: colors.text },
    since: { ...type('caption'), color: colors.textMuted },
    skeleton: { height: 72, borderRadius: radius.xl, marginBottom: spacing.sm },
  }), [colors, type]);

  const onUnblock = async (item: BlockedBusinessItem) => {
    const ok = await confirm({
      title: t('chats.blocked.unblockTitle', { name: item.name }),
      message: t('chats.blocked.unblockMessage'),
      confirmLabel: t('chats.blocked.unblock'),
    });
    if (!ok) return;
    unblock.mutate(item.businessId, {
      onSuccess: () => Toast.show({ type: 'success', text1: t('chats.blocked.unblocked', { name: item.name }) }),
      onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
    });
  };

  let empty: React.ReactElement;
  if (blocks.isLoading) {
    empty = <View>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (blocks.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('chats.blocked.loadErrorTitle')}
        subtitle={t('chats.blocked.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Blocked-retry"
        onCtaPress={() => void blocks.refetch()}
      />
    );
  } else {
    empty = <EmptyState icon={Ban} title={t('chats.blocked.emptyTitle')} subtitle={t('chats.blocked.emptySubtitle')} />;
  }

  return (
    <ScreenWrapper>
      <Header title={t('chats.blocked.title')} />
      <FlatList<BlockedBusinessItem>
        testID="Blocked-businesses-screen"
        data={blocks.data ?? []}
        keyExtractor={(b) => b.businessId}
        contentContainerStyle={s.list}
        ListHeaderComponent={<Text style={s.subtitle}>{t('chats.blocked.subtitle')}</Text>}
        ListEmptyComponent={empty}
        refreshing={blocks.isRefetching}
        onRefresh={() => void blocks.refetch()}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={s.rowBody}>
              <Text style={s.name} numberOfLines={1}>{item.name}</Text>
              <Text style={s.since}>{t('chats.blocked.since', { date: formatDate(Date.parse(item.blockedAt)) })}</Text>
            </View>
            <Button
              title={t('chats.blocked.unblock')}
              variant="outline"
              size="sm"
              onPress={() => void onUnblock(item)}
              phLabel={`Blocked-unblock-${item.businessId}`}
            />
          </View>
        )}
      />
    </ScreenWrapper>
  );
}
