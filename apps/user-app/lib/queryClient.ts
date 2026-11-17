import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { isFocusedState } from './app-focus';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Wires `refetchOnWindowFocus` to something that exists on a phone. React Query
 * listens for a browser focus event, and React Native has no window — without
 * this bridge, returning to the app shows whatever was cached when it left.
 *
 * @returns an unsubscribe function for the caller's effect cleanup
 */
export function startAppStateFocusTracking(): () => void {
  if (Platform.OS === 'web') return () => {};
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(isFocusedState(status));
  });
  return () => sub.remove();
}
