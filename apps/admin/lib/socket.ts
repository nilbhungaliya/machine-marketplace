import { io, Socket } from 'socket.io-client';
import { TOKEN_KEY } from './api';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export function getAdminSocket(): Socket {
  if (socket) return socket;

  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem(TOKEN_KEY)
      : null;

  socket = io(`${SOCKET_URL}/admin`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    console.log('[Admin Socket] Connected');
  });

  socket.on('disconnect', (reason) => {
    console.log('[Admin Socket] Disconnected:', reason);
  });

  return socket;
}

export function disconnectAdminSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
