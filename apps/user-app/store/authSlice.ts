import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { OnboardingStep } from '@mpm/shared-types';

export interface AuthState {
  token: string | null;
  userId: string | null;
  name: string | null;
  isAuthenticated: boolean;
  /** Where onboarding resumes (F1 spec §7): the root navigator shows Your business, Where are you? or the tabs. */
  onboarding: OnboardingStep;
  /** Open the "Get verified" intro before the tabs (shown once per device and user, right after onboarding). */
  gstIntro: boolean;
}

const initialState: AuthState = {
  token: null,
  userId: null,
  name: null,
  isAuthenticated: false,
  onboarding: 'profile',
  gstIntro: false,
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
    logout() {
      return initialState;
    },
  },
});

export const { setAuth, setOnboarding, dismissGstIntro, setName, logout } = authSlice.actions;
export default authSlice.reducer;
