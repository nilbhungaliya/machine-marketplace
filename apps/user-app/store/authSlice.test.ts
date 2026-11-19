import { describe, expect, it } from 'vitest';
import reducer, { browseAsGuest, dismissGstIntro, logout, setAuth, setName, setOnboarding, setPending } from './authSlice';

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

  it('starts signed out, not a guest, with nothing pending', () => {
    expect(reducer(undefined, { type: '@@init' })).toMatchObject({ isAuthenticated: false, guest: false, pending: null });
  });

  it('browseAsGuest opens the tabs without an account (spec §8.1)', () => {
    expect(reducer(undefined, browseAsGuest())).toMatchObject({ isAuthenticated: false, guest: true, token: null });
  });

  it('setAuth keeps a pending action for after onboarding', () => {
    const pending = { type: 'save', listingId: 'l1' } as const;
    const s = reducer(reducer(reducer(undefined, browseAsGuest()), setPending(pending)), setAuth({ token: 't', userId: 'u1', onboarding: 'done' }));
    expect(s).toMatchObject({ isAuthenticated: true, pending });
  });

  it('logout drops the guest flag and the pending action', () => {
    const s = reducer(reducer(undefined, browseAsGuest()), setPending({ type: 'save', listingId: 'l1' }));
    expect(reducer(s, logout())).toMatchObject({ guest: false, pending: null });
  });
});
