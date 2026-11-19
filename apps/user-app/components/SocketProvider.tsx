import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { routeSocketEvent, useSocket } from '@/hooks/useSocket';

/**
 * One `/user` socket for the signed-in user (F6 + F7 spec §13), mounted once in `navigation/root-navigator.tsx`
 * (`enabled` only when signed in: guests get none). Events go to their domain's handler by prefix
 * (`routeSocketEvent`). Screens send with `useSocketEmit()` (L6: `thread:viewing`) and refetch after a reconnect with
 * `useOnReconnect(fn)`.
 */

interface SocketContextValue {
  emit: (event: string, data?: unknown) => void;
  onReconnect: (fn: () => void) => () => void;
}

const noop: SocketContextValue = { emit: () => undefined, onReconnect: () => () => undefined };
const SocketContext = createContext<SocketContextValue>(noop);

export default function SocketProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<() => void>());
  const socketRef = useSocket(
    (event, data) => routeSocketEvent(queryClient, event, data),
    enabled,
    () => listeners.current.forEach((fn) => fn()),
  );

  const emit = useCallback(
    (event: string, data?: unknown) => {
      socketRef.current?.emit(event, data);
    },
    [socketRef],
  );
  const onReconnect = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo(() => ({ emit, onReconnect }), [emit, onReconnect]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/** `emit(event, data)` on the user's socket; a no-op while signed out or disconnected. */
export function useSocketEmit(): SocketContextValue['emit'] {
  return useContext(SocketContext).emit;
}

/** Runs `fn` after every reconnect while the component is mounted (refetch what may have been missed). */
export function useOnReconnect(fn: () => void): void {
  const { onReconnect } = useContext(SocketContext);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onReconnect(() => ref.current()), [onReconnect]);
}
