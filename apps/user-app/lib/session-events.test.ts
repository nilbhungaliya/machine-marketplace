import { describe, expect, it, vi } from 'vitest';
import { notifySessionEnded, onSessionEnded, sessionEndReason } from './session-events';

describe('sessionEndReason: which failed calls end the session', () => {
  it('a suspended or blocked account (403 ACCOUNT_SUSPENDED) ends it', () => {
    expect(sessionEndReason({ status: 403, code: 'ACCOUNT_SUSPENDED' })).toBe('suspended');
  });

  it('other failures do not', () => {
    expect(sessionEndReason({ status: 403, code: 'FORBIDDEN' })).toBeNull();
    expect(sessionEndReason({ status: 400, code: 'ACCOUNT_SUSPENDED' })).toBeNull();
    expect(sessionEndReason({ status: 401, code: 'UNAUTHORIZED' })).toBeNull();
    expect(sessionEndReason({})).toBeNull();
  });
});

describe('session-ended listeners', () => {
  it('every subscriber hears the reason until it unsubscribes', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onSessionEnded(a);
    const offB = onSessionEnded(b);
    notifySessionEnded('suspended');
    expect(a).toHaveBeenCalledWith('suspended');
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    notifySessionEnded('suspended');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it('a throwing listener does not stop the others', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offBad = onSessionEnded(bad);
    const offGood = onSessionEnded(good);
    expect(() => notifySessionEnded('suspended')).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
