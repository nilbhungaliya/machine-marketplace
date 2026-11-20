import { describe, expect, it } from 'vitest';
import reducer, { browseAsGuest, logout, setAuth, setOnboarding, setPending, takePending } from '@/store/authSlice';
import { isPendingAction, PENDING_CONTACT_TYPES, pendingRoute, pendingToRun } from './pending-action';

const save = { type: 'save', listingId: '6f1c2b1e-1111-4a4a-8a8a-000000000001' } as const;

describe('pending action (spec §8.1, R12)', () => {
  it('recognises serialisable save and contact actions only', () => {
    expect(isPendingAction(save)).toBe(true);
    expect(isPendingAction({ type: 'save' })).toBe(false);
    expect(isPendingAction({ type: 'enquire', listingId: 'x' })).toBe(true);
    expect(isPendingAction({ type: 'call', listingId: 'x' })).toBe(false);
    expect(isPendingAction(null)).toBe(false);
    expect(isPendingAction('save')).toBe(false);
  });

  // F6 + F7 §15.2 (plan C0-5): the four contact actions wait like Save, then go to openPendingContact, never to save.
  it.each(PENDING_CONTACT_TYPES)('%s waits for sign-in and onboarding, then runs with its listing id', (type) => {
    const action = { type, listingId: save.listingId };
    let s = reducer(undefined, browseAsGuest());
    s = reducer(s, setPending(action));
    expect(pendingToRun(s)).toBeNull();
    s = reducer(s, setAuth({ token: 't', userId: 'u1', onboarding: 'profile' }));
    expect(pendingToRun(s)).toBeNull();
    s = reducer(s, setOnboarding({ step: 'done', gstIntro: true }));
    expect(pendingToRun(s)).toEqual(action);
    expect(pendingRoute(action)).toBe('contact');
  });

  // F8 §13.3 (plan C0-5): "Post a requirement" from a guest waits the same way, then routes to the request path.
  it('post_request waits for sign-in and onboarding, then routes to the request path', () => {
    const action = { type: 'post_request', prefill: { source: 'no_results', name: 'Roller', kind: 'part' } } as const;
    expect(isPendingAction(action)).toBe(true);
    expect(isPendingAction({ type: 'post_request', prefill: { source: 'elsewhere' } })).toBe(false);
    expect(isPendingAction({ type: 'post_request' })).toBe(false);
    let s = reducer(undefined, browseAsGuest());
    s = reducer(s, setPending(action));
    expect(pendingToRun(s)).toBeNull();
    s = reducer(s, setAuth({ token: 't', userId: 'u1', onboarding: 'profile' }));
    expect(pendingToRun(s)).toBeNull();
    s = reducer(s, setOnboarding({ step: 'done', gstIntro: true }));
    expect(pendingToRun(s)).toEqual(action);
    expect(pendingRoute(action)).toBe('request');
  });

  it('routes save to the save path', () => {
    expect(pendingRoute(save)).toBe('save');
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
    expect(s.pending).toEqual({ type: 'save', listingId: '6f1c2b1e-1111-4a4a-8a8a-000000000002' });
  });

  it('is dropped on logout', () => {
    let s = reducer(undefined, setAuth({ token: 't', userId: 'u1', onboarding: 'profile' }));
    s = reducer(s, setPending(save));
    s = reducer(s, logout());
    expect(s.pending).toBeNull();
    expect(pendingToRun(s)).toBeNull();
  });
});
