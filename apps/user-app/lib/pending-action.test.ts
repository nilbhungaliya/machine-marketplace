import { describe, expect, it } from 'vitest';
import reducer, { browseAsGuest, logout, setAuth, setOnboarding, setPending, takePending } from '@/store/authSlice';
import { isPendingAction, pendingToRun } from './pending-action';

const save = { type: 'save', listingId: '6f1c2b1e-1111-4a4a-8a8a-000000000001' } as const;

describe('pending action (spec §8.1, R12)', () => {
  it('recognises a serialisable save action only', () => {
    expect(isPendingAction(save)).toBe(true);
    expect(isPendingAction({ type: 'save' })).toBe(false);
    expect(isPendingAction({ type: 'enquire', listingId: 'x' })).toBe(false);
    expect(isPendingAction(null)).toBe(false);
    expect(isPendingAction('save')).toBe(false);
  });

  it('is stored for a guest and waits until sign-in and onboarding are done', () => {
    let s = reducer(undefined, browseAsGuest());
    s = reducer(s, setPending(save));
    expect(s.pending).toEqual(save);
    expect(pendingToRun(s)).toBeNull();

    // A new user: signed in, but onboarding still gates.
    s = reducer(s, setAuth({ token: 't', userId: 'u1', onboarding: 'profile' }));
    expect(s.pending).toEqual(save);
    expect(pendingToRun(s)).toBeNull();
    s = reducer(s, setOnboarding({ step: 'location' }));
    expect(pendingToRun(s)).toBeNull();

    s = reducer(s, setOnboarding({ step: 'done', gstIntro: true }));
    expect(pendingToRun(s)).toEqual(save);
  });

  it('runs once: taking it clears it', () => {
    let s = reducer(undefined, browseAsGuest());
    s = reducer(s, setPending(save));
    s = reducer(s, setAuth({ token: 't', userId: 'u1', onboarding: 'done' }));
    const first = pendingToRun(s);
    expect(first).toEqual(save);
    s = reducer(s, takePending());
    expect(s.pending).toBeNull();
    expect(pendingToRun(s)).toBeNull();
  });

  it('is dropped on cancel and replaced by a new sign-in start', () => {
    let s = reducer(undefined, browseAsGuest());
    s = reducer(s, setPending(save));
    s = reducer(s, setPending(null));
    expect(s.pending).toBeNull();
    s = reducer(s, setPending(save));
    s = reducer(s, setPending({ type: 'save', listingId: '6f1c2b1e-1111-4a4a-8a8a-000000000002' }));
    expect(s.pending?.listingId).toBe('6f1c2b1e-1111-4a4a-8a8a-000000000002');
  });

  it('is dropped on logout', () => {
    let s = reducer(undefined, setAuth({ token: 't', userId: 'u1', onboarding: 'profile' }));
    s = reducer(s, setPending(save));
    s = reducer(s, logout());
    expect(s.pending).toBeNull();
    expect(pendingToRun(s)).toBeNull();
  });
});
