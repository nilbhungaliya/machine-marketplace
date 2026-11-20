import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NotificationCategory, NotificationRow } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationsList } from '@/hooks/use-notifications';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { NOTIFICATION_EVENTS } from '@/lib/analytics-events';
import { formatDayMonth, formatTime } from '@/lib/format-date';
import { BellRing, CalendarClock, Star, TAB_ICONS, Tag, TriangleAlert, type LucideIcon } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { notificationLink } from '@/lib/notification-links';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
  chat: TAB_ICONS.chats,
  offers: Tag,
  deals: TAB_ICONS.deals,
  reviews: Star,
  requests: BellRing,
  rentals: CalendarClock,
};

/** Today: the time; earlier: the day and month (IST). */
function when(iso: string): string {
  const ms = Date.parse(iso);
  return istDateKey(ms) === istDateKey(Date.now()) ? formatTime(ms) : formatDayMonth(ms);
}

/**
 * Notifications (F6 + F7 spec §11.6; mockup account · "Notifications"): rows with icon, title, body, time and an unread
 * fill; a tap marks the row read and opens its screen (`notificationLink`); Mark all as read; infinite scroll; the
 * unread count moves live through `notification:new`. Text is rendered by the server in my language (never message
 * text, §11.4); the grouped chat row says "3 new messages from …".
 */
export default function NotificationsScreen({ navigation }: RootStackScreenProps<'Notifications'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const list = useNotificationsList();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, flexGrow: 1 },
    // The rows read as one card (mockup `.notes`): hairline sides, rounded first and last rows, dividers between.
    row: {
      flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
      backgroundColor: colors.surface, borderColor: colors.hairline, borderLeftWidth: 1, borderRightWidth: 1,
      borderBottomWidth: 1, borderBottomColor: colors.divider, minHeight: 64,
    },
    rowNew: { backgroundColor: colors.primaryWash },
    first: { borderTopWidth: 1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
    last: { borderBottomColor: colors.hairline, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
    icon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    iconNew: { backgroundColor: colors.primary },
    text: { flex: 1, gap: 2 },
    title: { ...type('bodyStrong'), color: colors.text },
    body: { ...type('caption'), color: colors.textSecondary },
    time: { ...type('caption'), color: colors.textMuted },
    skeleton: { height: 64, borderRadius: radius.lg },
    footer: { marginTop: spacing.md },
  }), [colors, type]);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;
  const anyUnread = unread > 0 || items.some((n) => !n.read);

  const open = (n: NotificationRow) => {
    if (!n.read) markRead.mutate(n.id);
    track(NOTIFICATION_EVENTS.notificationOpened, { type: n.type });
    const route = notificationLink(n);
    // The union's names and params pair up in `notificationLink`.
    if (route) (navigation.navigate as (name: string, params?: object) => void)(route.name, route.params);
  };

  const renderItem = ({ item, index }: { item: NotificationRow; index: number }) => {
    const Icon = CATEGORY_ICONS[item.category] ?? BellRing;
    return (
      <Pressable
        style={({ pressed }) => [s.row, !item.read && s.rowNew, index === 0 && s.first, index === items.length - 1 && s.last, pressed && { opacity: 0.7 }]}
        onPress={() => open(item)}
        accessibilityRole="button"
        accessibilityLabel={item.read ? `${item.title}. ${item.body}` : `${t('notifications.unread')}. ${item.title}. ${item.body}`}
        testID={`Notification-${item.id}`}
      >
        <View style={[s.icon, !item.read && s.iconNew]}>
          <Icon size={18} color={item.read ? colors.textSecondary : colors.onPrimary} />
        </View>
        <View style={s.text}>
          <Text style={s.title} numberOfLines={2}>{item.title}</Text>
          {item.body ? <Text style={s.body} numberOfLines={2}>{item.body}</Text> : null}
        </View>
        <Text style={s.time}>{when(item.updatedAt)}</Text>
      </Pressable>
    );
  };

  let empty: React.ReactElement | null;
  if (list.isLoading) {
    empty = <View style={{ gap: spacing.sm }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (list.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('notifications.loadError')}
        subtitle={t('home.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Notifications-retry"
        onCtaPress={() => void list.refetch()}
      />
    );
  } else {
    empty = <EmptyState icon={BellRing} title={t('notifications.emptyTitle')} subtitle={t('notifications.emptyBody')} />;
  }

  return (
    <ScreenWrapper>
      <Header
        title={t('notifications.title')}
        rightIcon={anyUnread ? (
          <Button
            title={t('notifications.markAllRead')}
            onPress={() => markAll.mutate()}
            loading={markAll.isPending}
            variant="ghost"
            size="sm"
            phLabel="Notifications-read-all"
          />
        ) : undefined}
      />
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        ListEmptyComponent={empty}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={list.isFetchingNextPage ? <Skeleton style={[s.skeleton, s.footer]} /> : null}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
      />
    </ScreenWrapper>
  );
}
