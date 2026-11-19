import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { ThreadDetail, ThreadMessage } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import IconButton from '@/components/IconButton';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { useOnReconnect } from '@/components/SocketProvider';
import Composer from '@/components/chat/Composer';
import ContactBanner from '@/components/chat/ContactBanner';
import DealCard from '@/components/chat/DealCard';
import EnquiryCard from '@/components/chat/EnquiryCard';
import ListingStrip from '@/components/chat/ListingStrip';
import MaskedNumberNotice from '@/components/chat/MaskedNumberNotice';
import MessageBubble from '@/components/chat/MessageBubble';
import OfferCard from '@/components/chat/OfferCard';
import ReportConversationSheet from '@/components/chat/ReportConversationSheet';
import ScamWarning from '@/components/chat/ScamWarning';
import SystemLine from '@/components/chat/SystemLine';
import ThreadMenu, { type ThreadMenuAction } from '@/components/chat/ThreadMenu';
import ShareNumberSheet from '@/components/contact/ShareNumberSheet';
import OfferSheet from '@/components/offers/OfferSheet';
import {
  useAppActive, useArchiveThread, useBlockThread, useMarkRead, useMessages, useOpenThread, useThread, useThreadViewing,
} from '@/hooks/use-chat';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { CHAT_EVENTS } from '@/lib/analytics-events';
import { composerState } from '@/lib/chat-composer';
import { differentIstDay, newestSeq, photosExpired } from '@/lib/chat-format';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { istDayLabel } from '@/lib/format-date';
import { EllipsisVertical, Phone, TriangleAlert } from '@/lib/icons';
import { shareMessage } from '@/lib/share-listing';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** Refetching expired photo URLs at most this often (a broken image may fire several errors at once). */
const PHOTO_REFRESH_GAP_MS = 10_000;

/**
 * A conversation (F6 + F7 spec §6, §15.1; mockup negotiate · "Chat"): app bar with the other business, a call button
 * once numbers are revealed, ⋮ (share, report, block, archive); the listing strip ("No longer listed" when it isn't
 * public); the share-number banner once a deal exists; messages newest at the bottom with day lines, enquiry cards,
 * offer and deal cards (L7), system lines and scam warnings; the masked-number notice; the composer, or the line that
 * says why the reader can't write (viewer, blocked). Marks read on focus and on new messages; tells the server the
 * thread is on screen (no push for it); refetches after a reconnect.
 */
export default function ThreadScreen({ route, navigation }: RootStackScreenProps<'Thread'>) {
  const { threadId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const confirm = useConfirm();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const thread = useThread(threadId);
  const messages = useMessages(threadId);
  const markRead = useMarkRead(threadId);
  const archive = useArchiveThread();
  const block = useBlockThread(threadId);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [shareNumber, setShareNumber] = useState(false);
  const [quote, setQuote] = useState(false);
  const lastMarked = useRef<string | null>(null);
  const lastPhotoRefresh = useRef(0);

  useOpenThread(threadId, focused);
  useThreadViewing(threadId, focused);

  const refetchThread = thread.refetch;
  const refetchMessages = messages.refetch;
  useOnReconnect(() => {
    void refetchThread();
    void refetchMessages();
  });

  const items = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data]);
  const newest = newestSeq(messages.data?.pages);
  const detail = thread.data;

  // A return to the screen asks again (sockets are best-effort), and fresh photo URLs when the old ones ran out.
  const latest = useRef({ threadStale: thread.isStale, messagesStale: messages.isStale, items });
  latest.current = { threadStale: thread.isStale, messagesStale: messages.isStale, items };
  useFocusEffect(useCallback(() => {
    const now = latest.current;
    if (now.threadStale) void refetchThread();
    if (now.messagesStale || photosExpired(now.items, Date.now())) void refetchMessages();
  }, [refetchThread, refetchMessages]));

  // Read up to the newest loaded message while the thread is on screen with the app in front; a return to the
  // foreground re-runs this and reads what arrived meanwhile.
  useEffect(() => {
    if (!focused || !appActive || !detail || !newest) return;
    if (lastMarked.current === newest) return;
    if (detail.unread === 0 && BigInt(newest) <= BigInt(detail.lastReadSeq || '0')) {
      lastMarked.current = newest;
      return;
    }
    lastMarked.current = newest;
    markRead(newest);
  }, [focused, appActive, detail, newest, markRead]);

  const onPhotoExpired = useCallback(() => {
    const now = Date.now();
    if (now - lastPhotoRefresh.current < PHOTO_REFRESH_GAP_MS) return;
    lastPhotoRefresh.current = now;
    void refetchMessages();
  }, [refetchMessages]);

  const s = useMemo(() => StyleSheet.create({
    headRight: { flexDirection: 'row', gap: spacing.sm },
    list: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, flexGrow: 1 },
    item: { gap: spacing.xs },
    day: {
      alignSelf: 'center', ...type('badge'), color: colors.textMuted, backgroundColor: colors.field,
      borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginVertical: spacing.sm,
    },
    warning: { maxWidth: '88%' },
    reason: {
      ...type('caption'), color: colors.textSecondary, textAlign: 'center', marginHorizontal: spacing.lg,
      marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.field,
    },
    quote: { alignSelf: 'center', marginBottom: spacing.sm },
    skeleton: { height: 60, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
    empty: { ...type('caption'), color: colors.textMuted, textAlign: 'center', marginVertical: spacing.xl },
    older: { paddingVertical: spacing.md },
  }), [colors, type]);

  if (thread.isError && !detail) {
    return (
      <ScreenWrapper>
        <Header title={t('chats.thread.title')} />
        <EmptyState
          icon={TriangleAlert}
          title={t('chats.thread.loadErrorTitle')}
          subtitle={t('chats.thread.loadErrorBody')}
          ctaTitle={t('common.retry')}
          ctaPhLabel="Thread-retry"
          onCtaPress={() => void refetchThread()}
        />
      </ScreenWrapper>
    );
  }

  if (!detail) {
    return (
      <ScreenWrapper>
        <Header title={t('chats.thread.title')} />
        <View testID="Thread-screen">
          {[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}
        </View>
      </ScreenWrapper>
    );
  }

  const name = detail.counterpart.name;
  const viewer = detail.memberRole === 'viewer';
  const writing = composerState(detail);
  const strip = detail.listingStrip;
  const canQuote = writing.canWrite && detail.side === 'seller' && strip.priceModel === 'on_request'
    && !strip.noLongerListed && detail.openNegotiation === null;
  const callNumber = detail.contact.revealed ? detail.contact.number : null;

  const onMenu = async (action: ThreadMenuAction) => {
    setMenu(false);
    if (action === 'share') {
      try {
        await Share.share({ message: shareMessage({ ...strip, unit: strip.unit }) });
        track(CHAT_EVENTS.listingShared);
      } catch {
        // The share sheet was closed.
      }
      return;
    }
    if (action === 'archive' || action === 'unarchive') {
      const archived = action === 'archive';
      archive.mutate({ threadId, archived }, {
        onSuccess: () => {
          Toast.show({ type: 'success', text1: t(archived ? 'chats.menu.archived' : 'chats.menu.unarchived') });
          if (archived) navigation.goBack();
        },
        onError: () => Toast.show({ type: 'error', text1: t('chats.menu.archiveFailed') }),
      });
      return;
    }
    if (action === 'report') {
      setReport(true);
      return;
    }
    const ok = await confirm({
      title: t('chats.block.title', { name }),
      message: t('chats.block.message'),
      confirmLabel: t('chats.block.confirm'),
      destructive: true,
    });
    if (!ok) return;
    block.mutate(undefined, {
      onSuccess: () => Toast.show({ type: 'success', text1: t('chats.block.done') }),
      onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
    });
  };

  const renderMessage = (m: ThreadMessage, d: ThreadDetail) => {
    switch (m.kind) {
      case 'system':
        return m.system ? <SystemLine system={m.system} mySide={d.side} counterpartName={name} /> : null;
      case 'enquiry':
        return <EnquiryCard message={m} unitLabel={d.listingStrip.unit?.label ?? null} />;
      case 'offer':
        return m.offer ? <OfferCard offer={m.offer} thread={d} /> : null;
      case 'deal':
        return <DealCard message={m} thread={d} />;
      default:
        return <MessageBubble message={m} onPhotoExpired={onPhotoExpired} />;
    }
  };

  return (
    <ScreenWrapper keyboardAware>
      <Header
        title={name}
        rightIcon={(
          <View style={s.headRight}>
            {callNumber ? (
              <IconButton
                icon={Phone}
                onPress={() => void Linking.openURL(`tel:${callNumber}`)}
                accessibilityLabel={t('chats.thread.call', { name })}
                testID="Thread-call"
              />
            ) : null}
            <IconButton
              icon={EllipsisVertical}
              onPress={() => setMenu(true)}
              accessibilityLabel={t('chats.thread.menu')}
              testID="Thread-menu"
            />
          </View>
        )}
      />
      <ListingStrip
        strip={strip}
        machineTip={detail.machineTip}
        onOpen={strip.noLongerListed ? undefined : () => navigation.navigate('Listing', { listingId: strip.listingId })}
      />
      {detail.deals.length > 0 ? (
        <ContactBanner contact={detail.contact} counterpartName={name} onShare={() => setShareNumber(true)} />
      ) : null}
      <FlatList<ThreadMessage>
        inverted
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        testID="Thread-screen"
        renderItem={({ item, index }) => {
          const older = items[index + 1];
          const firstOfDay = !older || differentIstDay(older.createdAt, item.createdAt);
          return (
            <View style={s.item}>
              {firstOfDay ? <Text style={s.day}>{istDayLabel(Date.parse(item.createdAt))}</Text> : null}
              {renderMessage(item, detail)}
              {item.scamWarning && !item.isMine ? <ScamWarning style={s.warning} /> : null}
            </View>
          );
        }}
        ListHeaderComponent={detail.contact.revealed ? null : <MaskedNumberNotice />}
        ListFooterComponent={messages.isFetchingNextPage ? <ActivityIndicator style={s.older} color={colors.primary} /> : null}
        ListEmptyComponent={messages.isLoading ? null : <Text style={s.empty}>{t('chats.thread.noMessages')}</Text>}
        onEndReached={() => {
          if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
        }}
        onEndReachedThreshold={0.3}
      />
      {canQuote ? (
        <Button
          title={t('chats.thread.sendQuote')}
          variant="outline"
          size="sm"
          onPress={() => setQuote(true)}
          phLabel="Thread-send-quote"
          style={s.quote}
        />
      ) : null}
      {writing.canWrite ? (
        <Composer threadId={threadId} />
      ) : (
        <Text style={s.reason} testID="Thread-read-only">
          {writing.reasonKey ? t(writing.reasonKey, { name }) : null}
        </Text>
      )}
      <ThreadMenu
        visible={menu}
        counterpartName={name}
        archived={detail.archived}
        viewer={viewer}
        canBlock={detail.blockState !== 'blocked_by_me'}
        onSelect={(a) => void onMenu(a)}
        onClose={() => setMenu(false)}
      />
      <ReportConversationSheet
        visible={report}
        threadId={threadId}
        counterpartName={name}
        canBlock={detail.blockState !== 'blocked_by_me'}
        onClose={() => setReport(false)}
      />
      <ShareNumberSheet threadId={threadId} counterpartName={name} visible={shareNumber} onClose={() => setShareNumber(false)} />
      {canQuote || quote ? (
        <OfferSheet mode="quote" threadId={threadId} visible={quote} onClose={() => setQuote(false)} />
      ) : null}
    </ScreenWrapper>
  );
}
