import { describe, expect, it } from 'vitest';
import reducer, { completeOnboarding, logout, setAuth } from './authSlice';

describe('authSlice', () => {
  const signedIn = reducer(undefined, setAuth({ token: 't', userId: 'u1', isNewUser: true }));

  it('setAuth signs in and keeps the onboarding flag', () => {
    expect(signedIn).toMatchObject({ token: 't', userId: 'u1', isAuthenticated: true, isNewUser: true });
  });

  it('completeOnboarding clears only the flag', () => {
    expect(reducer(signedIn, completeOnboarding())).toMatchObject({ isAuthenticated: true, isNewUser: false });
  });

  it('logout resets everything', () => {
    expect(reducer(signedIn, logout())).toEqual(reducer(undefined, { type: '@@init' }));
  });
});
