import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as SecureStore from 'expo-secure-store';
import Toast from 'react-native-toast-message';
import type { BusinessProfile, OnboardingStep } from '@mpm/shared-types';
import {
  setAuth,
  setName,
  setOnboarding,
  dismissGstIntro as dismissGstIntroAction,
  logout as logoutAction,
} from '@/store/authSlice';
import { TOKEN_KEY } from '@/lib/api';
import { errorCode, errorStatus } from '@/lib/api-error';
import { fetchMyBusiness } from '@/lib/business-api';
import { i18n } from '@/lib/i18n';
import { sessionEndReason } from '@/lib/session-events';
import { decodeJwtPayload, isExpired } from '@/lib/jwt';
import { queryClient } from '@/lib/queryClient';
import {
  cachedStep,
  cacheStep,
  hasSeenGstIntro,
  markGstIntroSeen,
  shouldShowGstIntro,
  stepAfterBootError,
} from '@/lib/onboarding-step';
import { AUTH_EVENTS, identifyUser, resetAnalytics, track } from '@/lib/analytics';
import { setErrorUser } from '@/lib/error-reporting';
import { businessKeys } from '@/hooks/use-business';
import type { AppDispatch, RootState } from '@/store';

/** A cold start waits on this call before showing anything, so it gives up sooner than the default 15 s. */
const BOOT_TIMEOUT_MS = 6000;

/** Why the session ended: a suspended or blocked account (F1 spec §8.2), at boot or mid-session. */
export function showSuspendedToast(): void {
  Toast.show({ type: 'error', text1: i18n.t('errors.auth.suspended') });
}

/** The intro is offered once onboarding is done, GST isn't verified, and this device hasn't shown it to the user. */
async function wantsGstIntro(userId: string, step: OnboardingStep, gstVerified: boolean): Promise<boolean> {
  if (step !== 'done' || gstVerified) return false;
  return shouldShowGstIntro({ step, gstVerified, seen: await hasSeenGstIntro(userId) });
}

export function useAuth() {
  const dispatch = useDispatch<AppDispatch>();
  const auth = useSelector((state: RootState) => state.auth);

  /** Keeps the cached business and the person's name in step with a profile the API returned. */
  const remember = useCallback(
    (profile: BusinessProfile) => {
      queryClient.setQueryData(businessKeys.me, profile);
      if (profile.userName) dispatch(setName(profile.userName));
    },
    [dispatch],
  );

  const login = useCallback(
    async (token: string, userId: string, onboarding: OnboardingStep) => {
      // React Query keys are not user-scoped: never show a previous account's data.
      queryClient.clear();
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      identifyUser(userId);
      setErrorUser(userId);
      let gstIntro = false;
      if (onboarding === 'done' && !(await hasSeenGstIntro(userId))) {
        // A returning user on a new install: offer the intro unless GST is already verified.
        try {
          const profile = await fetchMyBusiness();
          if (profile) {
            remember(profile);
            gstIntro = await wantsGstIntro(userId, onboarding, profile.completion.gst);
          }
        } catch {
          // No intro this time; Profile still offers GST verification.
        }
      }
      void cacheStep(userId, onboarding);
      dispatch(setAuth({ token, userId, onboarding, gstIntro }));
    },
    [dispatch, remember],
  );

  /**
   * After a save on Your business or Where are you?: the API's `onboarding` moves the root navigator on. Finishing
   * onboarding opens the GST intro first (once per device and user).
   */
  const applyProfile = useCallback(
    async (profile: BusinessProfile) => {
      remember(profile);
      const userId = auth.userId;
      if (!userId || profile.onboarding === auth.onboarding) return;
      const gstIntro = await wantsGstIntro(userId, profile.onboarding, profile.completion.gst);
      void cacheStep(userId, profile.onboarding);
      dispatch(setOnboarding({ step: profile.onboarding, gstIntro }));
    },
    [auth.onboarding, auth.userId, dispatch, remember],
  );

  /** Verify or Skip on the intro: it isn't offered again to this user on this device. */
  const dismissGstIntro = useCallback(async () => {
    if (auth.userId) await markGstIntroSeen(auth.userId);
    dispatch(dismissGstIntroAction());
  }, [auth.userId, dispatch]);

  const logout = useCallback(async () => {
    track(AUTH_EVENTS.loggedOut);
    // Without these the next person on this device inherits the profile.
    resetAnalytics();
    setErrorUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    queryClient.clear();
    dispatch(logoutAction());
  }, [dispatch]);

  /**
   * Restores a saved session on boot and re-reads `GET /businesses/me` for the onboarding step (F1 spec §7). Resolves
   * false when there is no session (none saved, expired, rejected, or the account is suspended).
   */
  const loadToken = useCallback(async (): Promise<boolean> => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return false;
    const payload = decodeJwtPayload(token);
    if (!payload || isExpired(payload)) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      return false;
    }
    const userId = payload.userId;
    setErrorUser(userId);

    let step: OnboardingStep;
    let gstIntro = false;
    try {
      const profile = await fetchMyBusiness({ timeout: BOOT_TIMEOUT_MS });
      if (profile) {
        remember(profile);
        step = profile.onboarding;
        gstIntro = await wantsGstIntro(userId, step, profile.completion.gst);
      } else {
        step = 'profile';
      }
    } catch (err) {
      const failure = { status: errorStatus(err), code: errorCode(err) };
      const resumed = stepAfterBootError(failure, await cachedStep(userId));
      if (resumed === 'signed_out') {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setErrorUser(null);
        if (sessionEndReason(failure) === 'suspended') showSuspendedToast();
        return false;
      }
      step = resumed;
    }
    void cacheStep(userId, step);
    dispatch(setAuth({ token, userId, onboarding: step, gstIntro }));
    return true;
  }, [dispatch, remember]);

  return { ...auth, login, logout, loadToken, applyProfile, dismissGstIntro };
}
