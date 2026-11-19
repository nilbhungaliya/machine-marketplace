import { describe, it, expect, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const asyncStore: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncStore[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete asyncStore[k];
    }),
  },
}));
const { unregisterPush } = vi.hoisted(() => ({ unregisterPush: vi.fn(async (_token: string | null) => {}) }));
vi.mock('@/lib/push', () => ({ unregisterPush }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => 'session-token'),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock('expo-location', () => ({ Accuracy: { Balanced: 3 } }));
vi.mock('react-native', () => ({ Linking: { openSettings: vi.fn() } }));
vi.mock('react-native-toast-message', () => ({ default: { show: vi.fn() } }));
vi.mock('posthog-react-native', () => ({ default: class {} }));
vi.mock('@sentry/react-native', () => ({ init: vi.fn(), setUser: vi.fn() }));
vi.mock('@/lib/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient() };
});

import authReducer, { browseAsGuest, setAuth } from '@/store/authSlice';
import { signOut } from './useAuth';
import { originStore } from './use-discovery-origin';

describe('sign-out clears on-device discovery data (DPDP, shared devices)', () => {
  it('forgets recently viewed, recent searches, pincode, source, the guest flag and the in-memory origin', async () => {
    Object.assign(asyncStore, {
      'discover.recent.v1': JSON.stringify(['00000000-0000-4000-8000-000000000001']),
      'search.recent.v1': JSON.stringify(['bearing 6205']),
      'discover.pincode.v1': '395003',
      'discover.mode.v1': 'pincode',
      'discover.radius.v1': '25',
      'auth.guest.v1': '1',
    });
    originStore.hydrate({ radiusKm: 25, pincode: '395003', mode: 'pincode' });
    originStore.setPermission('granted');
    originStore.setFix(21.17, 72.83);
    originStore.applyEcho({ source: 'gps', label: 'Udhna' } as never);

    const store = configureStore({ reducer: { auth: authReducer } });
    store.dispatch(browseAsGuest());
    store.dispatch(setAuth({ token: 't', userId: 'u', onboarding: 'done' }));

    await signOut(store.dispatch);

    expect(Object.keys(asyncStore).sort()).toEqual(['discover.mode.v1', 'discover.radius.v1']);
    expect(asyncStore['discover.mode.v1']).toBe('auto');
    expect(originStore.getSnapshot()).toMatchObject({ mode: 'auto', pincode: null, fix: null, echo: null });
    expect(store.getState().auth).toMatchObject({ isAuthenticated: false, guest: false, pending: null });
    // Every sign-out path deletes this phone's push device with the session's token (F6 + F7 §11.6).
    expect(unregisterPush).toHaveBeenCalledWith('session-token');
  });
});
