import { describe, expect, it } from 'vitest';
import reducer, { dismissGstIntro, logout, setAuth, setName, setOnboarding } from './authSlice';

describe('authSlice', () => {
  const signedIn = reducer(undefined, setAuth({ token: 't', userId: 'u1', onboarding: 'profile' }));

  it('setAuth signs in and stores the onboarding step', () => {
    expect(signedIn).toMatchObject({ token: 't', userId: 'u1', isAuthenticated: true, onboarding: 'profile', gstIntro: false });
    expect(signedIn).not.toHaveProperty('isNewUser');
  });

  it('setAuth can ask for the GST intro', () => {
    expect(reducer(undefined, setAuth({ token: 't', userId: 'u1', onboarding: 'done', gstIntro: true }))).toMatchObject({
      onboarding: 'done',
      gstIntro: true,
    });
  });

  it('setOnboarding moves the step and sets the intro flag', () => {
    const atLocation = reducer(signedIn, setOnboarding({ step: 'location' }));
    expect(atLocation).toMatchObject({ isAuthenticated: true, onboarding: 'location', gstIntro: false });
    const done = reducer(atLocation, setOnboarding({ step: 'done', gstIntro: true }));
    expect(done).toMatchObject({ onboarding: 'done', gstIntro: true });
    expect(reducer(done, dismissGstIntro())).toMatchObject({ onboarding: 'done', gstIntro: false });
  });

  it('setName keeps the name', () => {
    expect(reducer(signedIn, setName('Hitesh')).name).toBe('Hitesh');
  });

  it('logout resets everything', () => {
    expect(reducer(signedIn, logout())).toEqual(reducer(undefined, { type: '@@init' }));
  });
});
