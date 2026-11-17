import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setAuth,
  setName,
  completeOnboarding as completeOnboardingAction,
  logout as logoutAction,
} from '@/store/authSlice';
import { TOKEN_KEY } from '@/lib/api';
import { decodeJwtPayload, isExpired } from '@/lib/jwt';
import { queryClient } from '@/lib/queryClient';
import { ONBOARDING_PENDING_KEY } from '@/lib/onboarding';
import { AUTH_EVENTS, identifyUser, resetAnalytics, track } from '@/lib/analytics';
import { setErrorUser } from '@/lib/error-reporting';
import type { AppDispatch, RootState } from '@/store';

export function useAuth() {
  const dispatch = useDispatch<AppDispatch>();
  const auth = useSelector((state: RootState) => state.auth);

  const login = useCallback(
    async (token: string, userId: string, isNewUser: boolean) => {
      // React Query keys are not user-scoped: never show a previous account's data.
      queryClient.clear();
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      // Redux is in-memory; persisted so a cold start on the name screen resumes it.
      if (isNewUser) await AsyncStorage.setItem(ONBOARDING_PENDING_KEY, '1');
      else await AsyncStorage.removeItem(ONBOARDING_PENDING_KEY);
      identifyUser(userId);
      setErrorUser(userId);
      dispatch(setAuth({ token, userId, isNewUser }));
    },
    [dispatch],
  );

  const completeOnboarding = useCallback(
    (name: string) => {
      void AsyncStorage.removeItem(ONBOARDING_PENDING_KEY);
      dispatch(setName(name));
      dispatch(completeOnboardingAction());
    },
    [dispatch],
  );

  const logout = useCallback(async () => {
    track(AUTH_EVENTS.loggedOut);
    // Without these the next person on this device inherits the profile.
    resetAnalytics();
    setErrorUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await AsyncStorage.removeItem(ONBOARDING_PENDING_KEY);
    queryClient.clear();
    dispatch(logoutAction());
  }, [dispatch]);

  /** Restores a saved session on boot. Resolves false when there is none (or it expired). */
  const loadToken = useCallback(async (): Promise<boolean> => {
    const [token, pending] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      AsyncStorage.getItem(ONBOARDING_PENDING_KEY),
    ]);
    if (!token) return false;
    const payload = decodeJwtPayload(token);
    if (!payload || isExpired(payload)) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      return false;
    }
    setErrorUser(payload.userId);
    dispatch(setAuth({ token, userId: payload.userId, isNewUser: pending === '1' }));
    return true;
  }, [dispatch]);

  return { ...auth, login, logout, loadToken, completeOnboarding };
}
