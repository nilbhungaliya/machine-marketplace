import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { TOKEN_KEY } from '@/lib/api';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export function useSocket(
  onEvent: (event: string, data: any) => void,
  enabled: boolean = true,
) {
  const socketRef = useRef<Socket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let socket: Socket;

    async function connect() {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) return;

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

      socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
      });

      socket.on('connect_error', (err) => {
        console.log('[Socket] Connection error:', err.message);
      });

      socketRef.current = socket;
    }

    connect();

    return () => {
      if (socket) {
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [enabled]);

  return socketRef;
}
