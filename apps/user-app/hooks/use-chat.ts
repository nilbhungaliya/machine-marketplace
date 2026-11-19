import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ContactPhoneState, ConversationReportReason, InboxFilter, InboxPage, ThreadDetail } from '@mpm/shared-types';
import { CHAT_LIMITS } from '@mpm/shared-types';
import { useSocketEmit } from '@/components/SocketProvider';
import { track } from '@/lib/analytics';
import { CHAT_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import {
  blockThread, fetchBlocks, fetchMessages, fetchThread, fetchThreads, markThreadRead, presignThreadPhoto, removeContactPhone,
  reportThread, sendContactPhoneOtp, sendEnquiry, sendMessage, setThreadArchived, shareContact, unblockBusiness, verifyContactPhone,
  type EnquiryBody, type SendMessageBody,
} from '@/lib/chat-api';
import { markRowRead, olderPageParam, removeRow, type MessagePage } from '@/lib/chat-format';
import { preparePhoto, putFile } from '@/lib/media-device';
import { qk } from '@/lib/query-keys';
import { applyMessageToCaches, setOpenThread } from '@/lib/socket-chat';

/**
 * Server state for chat (F6 + F7 spec §6, §12.2; textile `hooks/use-chat.ts`): the inbox, a thread and its messages,
 * sending, reading, archive, share my number, report, block, the enquiry, blocked businesses and the contact number.
 * Lists go stale fast: sockets are best-effort, so a focus or a reconnect asks again. Keys come from `lib/query-keys.ts`
 * (shared with the socket handler); the two lists only this lane reads keep their keys here.
 */

const CHAT_STALE_MS = 15_000;

export const chatKeys = {
  blocks: ['users', 'me', 'blocks'] as const,
  /** The contact number as last answered by verify / remove (the API has no read of it, see the screen). */
  contactPhone: ['businesses', 'me', 'contact-phone'] as const,
};

export function useThreads(filter: InboxFilter, archived: boolean) {
  return useInfiniteQuery({
    queryKey: qk.threads(filter, archived),
    queryFn: ({ pageParam }) => fetchThreads(filter, archived, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: InboxPage) => last.nextCursor ?? undefined,
    staleTime: CHAT_STALE_MS,
  });
}

export function useThread(threadId: string) {
  return useQuery({ queryKey: qk.thread(threadId), queryFn: () => fetchThread(threadId), staleTime: CHAT_STALE_MS });
}

/** Newest first: the screen draws them inverted, so the newest sits at the bottom and older pages load upwards. */
export function useMessages(threadId: string) {
  return useInfiniteQuery({
    queryKey: qk.messages(threadId),
    queryFn: ({ pageParam }) => fetchMessages(threadId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: MessagePage) => olderPageParam(last),
    staleTime: CHAT_STALE_MS,
  });
}

/** Whether the app is in the foreground; a return to it re-renders (and re-runs effects that depend on it). */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Marks the thread on screen (its inbox row keeps unread 0 while a message arrives). Only while the screen is focused
 * and the app is in front: a message that lands while the app is in the background stays unread.
 */
export function useOpenThread(threadId: string, focused: boolean): void {
  const active = useAppActive();
  const open = focused && active;
  useEffect(() => {
    if (!open) return undefined;
    setOpenThread(threadId);
    return () => setOpenThread(null);
  }, [threadId, open]);
}

/**
 * `thread:viewing { threadId }` on focus and every 20 s while the thread is on screen with the app in front, `null` on
 * blur, on leaving the app and on unmount (§11.5, §13): no chat push for a thread being read.
 */
export function useThreadViewing(threadId: string, focused: boolean): void {
  const emit = useSocketEmit();
  useEffect(() => {
    if (!focused) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      emit('thread:viewing', { threadId });
      timer = setInterval(() => emit('thread:viewing', { threadId }), CHAT_LIMITS.viewingRefreshSeconds * 1000);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      emit('thread:viewing', { threadId: null });
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [threadId, focused, emit]);
}

export function useSendMessage(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendMessageBody) => sendMessage(threadId, body),
    onSuccess: (message, body) => {
      track(CHAT_EVENTS.messageSent, { photos: body.photoKeys?.length ?? 0 });
      applyMessageToCaches(queryClient, message);
      // The socket brings the row; without it, the lists are stale and refetch when shown.
      void queryClient.invalidateQueries({ queryKey: qk.allThreads, refetchType: 'none' });
    },
  });
}

/** One picked photo → re-encoded on the device (≤ 1 600 px JPEG, no EXIF) → presigned → uploaded; returns its key. */
export async function uploadChatPhoto(threadId: string, uri: string, size?: { width: number; height: number }): Promise<string> {
  const files = await preparePhoto(uri, size);
  const full = files.find((f) => f.role === 'full') ?? files[0]!;
  const signed = await presignThreadPhoto(threadId, full.contentType, full.size);
  await putFile(signed.url, full, () => undefined);
  return signed.key;
}

/** Marks the thread read up to `seq`: the lists show it at once, the badge asks the server again. */
export function useMarkRead(threadId: string) {
  const queryClient = useQueryClient();
  return useCallback((seq: string) => {
    queryClient.setQueriesData<InfiniteData<InboxPage>>({ queryKey: qk.allThreads }, (data) =>
      data?.pages ? { ...data, pages: markRowRead(data.pages, threadId) } : data,
    );
    queryClient.setQueryData<ThreadDetail>(qk.thread(threadId), (d) => (d ? { ...d, unread: 0 } : d));
    void markThreadRead(threadId, seq)
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: qk.badges() });
        void queryClient.invalidateQueries({ queryKey: qk.notifications() });
      });
  }, [queryClient, threadId]);
}

/** Archive or unarchive for this user (viewers too, P15): the row leaves the list at once, then the lists ask again. */
export function useArchiveThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, archived }: { threadId: string; archived: boolean }) => setThreadArchived(threadId, archived),
    onMutate: ({ threadId }) => {
      queryClient.setQueriesData<InfiniteData<InboxPage>>({ queryKey: qk.allThreads }, (data) =>
        data?.pages ? { ...data, pages: removeRow(data.pages, threadId) } : data,
      );
    },
    onSuccess: (_r, { archived }) => {
      if (archived) track(CHAT_EVENTS.threadArchived);
    },
    onSettled: (_r, _e, { threadId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.allThreads });
      void queryClient.invalidateQueries({ queryKey: qk.thread(threadId), exact: true });
      void queryClient.invalidateQueries({ queryKey: qk.badges() });
    },
  });
}

/** The share-my-number tick (§6.6). The thread and the deals refetch: the reveal changes both. */
export function useShareContact(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => shareContact(threadId, idempotencyKey),
    onSuccess: () => {
      track(CHAT_EVENTS.contactShared);
      void queryClient.invalidateQueries({ queryKey: qk.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: qk.allDeals });
      void queryClient.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useReportThread(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: ConversationReportReason; details: string | null; block: boolean }) => reportThread(threadId, body),
    onSuccess: (_r, body) => {
      track(CHAT_EVENTS.conversationReported, { reason: body.reason });
      if (body.block) {
        track(CHAT_EVENTS.businessBlocked);
        void queryClient.invalidateQueries({ queryKey: qk.thread(threadId) });
        void queryClient.invalidateQueries({ queryKey: chatKeys.blocks });
      }
    },
  });
}

export function useBlockThread(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => blockThread(threadId),
    onSuccess: () => {
      track(CHAT_EVENTS.businessBlocked);
      void queryClient.invalidateQueries({ queryKey: qk.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: qk.allThreads });
      void queryClient.invalidateQueries({ queryKey: chatKeys.blocks });
    },
  });
}

export function useBlocks() {
  return useQuery({ queryKey: chatKeys.blocks, queryFn: fetchBlocks });
}

export function useUnblock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (businessId: string) => unblockBusiness(businessId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.blocks });
      void queryClient.invalidateQueries({ queryKey: qk.allThreads });
      void queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

/** The Enquire sheet's send (§6.1, §6.3): the thread opens with the card in it. */
export function useSendEnquiry(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: EnquiryBody; idempotencyKey: string }) => sendEnquiry(listingId, body, idempotencyKey),
    onSuccess: (result, { body }) => {
      track(CHAT_EVENTS.enquirySent, { quickCount: body.quick.length, hasNote: body.note !== null, hasMachine: body.fit !== null });
      applyMessageToCaches(queryClient, result.message);
      void queryClient.invalidateQueries({ queryKey: qk.allThreads });
      // The listing page's "Open chat" reads `myThreadId`.
      void queryClient.invalidateQueries({ queryKey: ['listings', 'detail', listingId] });
    },
  });
}

// ─── Contact number (owner only) ───

export function useContactPhoneState() {
  return useQuery<ContactPhoneState | null>({
    queryKey: chatKeys.contactPhone,
    queryFn: () => null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSendContactPhoneOtp() {
  return useMutation({ mutationFn: (phone: string) => sendContactPhoneOtp(phone) });
}

export function useVerifyContactPhone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => verifyContactPhone(code),
    onSuccess: (state) => {
      queryClient.setQueryData(chatKeys.contactPhone, state);
      void queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

export function useRemoveContactPhone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeContactPhone(),
    onSuccess: (state) => {
      queryClient.setQueryData(chatKeys.contactPhone, state);
      void queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

/** An error code for analytics `reason` properties. */
export const chatErrorReason = (err: unknown): string => errorCode(err);
