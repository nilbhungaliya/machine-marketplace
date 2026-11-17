import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface AuthState {
  token: string | null;
  userId: string | null;
  name: string | null;
  isAuthenticated: boolean;
  /** Signed in but onboarding (name + business) not finished. */
  isNewUser: boolean;
}

const initialState: AuthState = {
  token: null,
  userId: null,
  name: null,
  isAuthenticated: false,
  isNewUser: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<{ token: string; userId: string; isNewUser: boolean }>) {
      state.token = action.payload.token;
      state.userId = action.payload.userId;
      state.isAuthenticated = true;
      state.isNewUser = action.payload.isNewUser;
    },
    setName(state, action: PayloadAction<string>) {
      state.name = action.payload;
    },
    completeOnboarding(state) {
      state.isNewUser = false;
    },
    logout() {
      return initialState;
    },
  },
});

export const { setAuth, setName, completeOnboarding, logout } = authSlice.actions;
export default authSlice.reducer;
