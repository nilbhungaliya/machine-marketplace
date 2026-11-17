import { describe, it, expect, vi } from 'vitest';

vi.mock('@sentry/react-native', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
}));

import { redact, scrubEvent, scrubBreadcrumb } from './error-reporting';

describe('redact', () => {
  it('removes credentials and personal fields by key', () => {
    expect(redact({
      authorization: 'Bearer eyJ...',
      jwt_token: 'tok',
      phone: '+919876543210',
      otp: '123456',
      screen: 'LotDetail',
    })).toEqual({
      authorization: '[redacted]',
      jwt_token: '[redacted]',
      phone: '[redacted]',
      otp: '[redacted]',
      screen: 'LotDetail',
    });
  });

  it('removes the one-time phone token', () => {
    expect(redact({ phone_token: 'eyJ...', firebase_token: 'x' }))
      .toEqual({ phone_token: '[redacted]', firebase_token: '[redacted]' });
  });

  it('reaches nested objects and arrays', () => {
    expect(redact({ req: { headers: { Authorization: 'Bearer x' } }, list: [{ phone: '+91' }] }))
      .toEqual({ req: { headers: { Authorization: '[redacted]' } }, list: [{ phone: '[redacted]' }] });
  });
});

describe('scrubEvent', () => {
  it('drops the request body and scrubs headers', () => {
    const e = scrubEvent({
      request: { headers: { authorization: 'Bearer x' }, data: { otp: '1234' }, cookies: { a: '1' } },
    });
    expect(e.request.data).toBeUndefined();
    expect(e.request.cookies).toBeUndefined();
    expect(e.request.headers.authorization).toBe('[redacted]');
  });

  /**
   * A crash needs to be attributable to an account, but nothing more. Sentry
   * would otherwise carry whatever it inferred about the user.
   */
  it('keeps the user id and discards everything else about them', () => {
    const e = scrubEvent({ user: { id: 'u-1', email: 'a@b.c', ip_address: '1.2.3.4', username: 'raj' } });
    expect(e.user).toEqual({ id: 'u-1' });
  });

  it('leaves an event with nothing sensitive unchanged', () => {
    const e = scrubEvent({ request: { headers: { 'content-type': 'application/json' } } });
    expect(e.request.headers['content-type']).toBe('application/json');
  });

  it('survives an empty event', () => {
    expect(scrubEvent(null)).toBe(null);
    expect(scrubEvent({})).toEqual({});
  });
});

describe('scrubBreadcrumb', () => {
  // The axios integration records request headers, which carry our JWT.
  it('scrubs breadcrumb data', () => {
    const c = scrubBreadcrumb({ category: 'xhr', data: { authorization: 'Bearer x', url: '/listings/123' } });
    expect(c.data.authorization).toBe('[redacted]');
    expect(c.data.url).toBe('/listings/123');
  });
});
