import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { OnboardingStep } from '@mpm/shared-types';
import type { PendingAction } from '@/lib/pending-action';

export interface AuthState {
  token: string | null;
  userId: string | null;
  name: string | null;
  isAuthenticated: boolean;
  /** Where onboarding resumes (F1 spec §7): the root navigator shows Your business, Where are you? or the tabs. */
  onboarding: OnboardingStep;
  /** Open the "Get verified" intro before the tabs (shown once per device and user, right after onboarding). */
  gstIntro: boolean;
  /**
   * Browsing without an account (F4 + F5 spec §8.1, R12): Welcome's "Browse first" opens the tabs as a guest. Ignored
   * while `isAuthenticated`.
   */
  guest: boolean;
  /**
   * What a guest was doing when asked to sign in (`{ type: 'save', listingId }`): run once after sign-in and onboarding
   * (`pendingToRun`, `takePending`), dropped on cancel or a new sign-in start (`setPending(null)`) and on logout.
   */
  pending: PendingAction | null;
}

const initialState: AuthState = {
  token: null,
  userId: null,
  name: null,
  isAuthenticated: false,
  onboarding: 'profile',
  gstIntro: false,
  guest: false,
  pending: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<{ token: string; userId: string; onboarding: OnboardingStep; gstIntro?: boolean }>) {
      state.token = action.payload.token;
      state.userId = action.payload.userId;
      state.isAuthenticated = true;
      state.onboarding = action.payload.onboarding;
      state.gstIntro = action.payload.gstIntro ?? false;
    },
    setOnboarding(state, action: PayloadAction<{ step: OnboardingStep; gstIntro?: boolean }>) {
      state.onboarding = action.payload.step;
      state.gstIntro = action.payload.gstIntro ?? false;
    },
    dismissGstIntro(state) {
      state.gstIntro = false;
    },
    setName(state, action: PayloadAction<string>) {
      state.name = action.payload;
    },
    browseAsGuest(state) {
      state.guest = true;
    },
    setPending(state, action: PayloadAction<PendingAction | null>) {
      state.pending = action.payload;
    },
    /** The pending action is about to run: clear it first, so it runs once. */
    takePending(state) {
      state.pending = null;
    },
    logout() {
      return initialState;
    },
  },
});

export const { setAuth, setOnboarding, dismissGstIntro, setName, browseAsGuest, setPending, takePending, logout } = authSlice.actions;
export default authSlice.reducer;
