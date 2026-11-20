import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import type { QueryClient } from '@tanstack/react-query';
import { TOKEN_KEY } from '@/lib/api';
import { handleChatEvent } from '@/lib/socket-chat';
import { handleDealEvent } from '@/lib/socket-deals';
import { handleNotificationEvent } from '@/lib/socket-notifications';
import { handlePartRequestEvent } from '@/lib/socket-part-requests';
import { handleRentalEvent } from '@/lib/socket-rentals';
import { socketDomain } from '@/lib/socket-route';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

/** Sends a `/user` event to its domain's handler by prefix (F6 + F7 §13): chat, deals or notifications. */
export function routeSocketEvent(queryClient: QueryClient, event: string, data: unknown): void {
  switch (socketDomain(event)) {
    case 'chat':
      return handleChatEvent(queryClient, event, data);
    case 'deals':
      return handleDealEvent(queryClient, event, data);
    case 'notifications':
      return handleNotificationEvent(queryClient, event, data);
    case 'part_requests':
      return handlePartRequestEvent(queryClient, event, data);
    case 'rentals':
      return handleRentalEvent(queryClient, event, data);
    default:
      return;
  }
}

/**
 * The `/user` socket. One per signed-in user: `components/SocketProvider.tsx` mounts it once; screens use
 * `useSocketEmit()` / `useOnReconnect()` from there instead of opening their own.
 * `onReconnect` runs after a reconnect (not the first connect): clients refetch what they may have missed.
 */
export function useSocket(
  onEvent: (event: string, data: any) => void,
  enabled: boolean = true,
  onReconnect?: () => void,
) {
  const socketRef = useRef<Socket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!enabled) return;

    let socket: Socket | undefined;
    let cancelled = false;

    async function connect() {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token || cancelled) return;

      socket = io(`${API_URL}/user`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
      });

      socket.on('connect', () => {
        console.log('[Socket] Connected to /user');
      });

      // Forward EVERY event rather than registering `socket.on` per name: an
      // allow-list silently drops any event the server adds later. Callers filter.
      // Socket.IO keeps its lifecycle events (connect, disconnect, connect_error)
      // out of onAny, so those are handled below.
      socket.onAny((event: string, data: any) => {
        onEventRef.current(event, data);
      });

      socket.io.on('reconnect', () => {
        onReconnectRef.current?.();
      });

      socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
      });

      socket.on('connect_error', (err) => {
        console.log('[Socket] Connection error:', err.message);
      });

      socketRef.current = socket;
    }

    void connect();

    return () => {
      cancelled = true;
      if (socket) {
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [enabled]);

  return socketRef;
}
