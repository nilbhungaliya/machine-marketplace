/**
 * Sentry reports leave our servers, so what they carry is a privacy boundary.
 *
 * @sentry/node v10 collects user info and request bodies by default, and its
 * http integration puts request headers into breadcrumbs — which for this API
 * means JWTs, phone numbers and Razorpay signatures.
 */
import { describe, it, expect } from 'vitest';
import { redact, scrub } from '../src/lib/sentry.js';

describe('redact', () => {
  it('removes credentials and personal fields by key', () => {
    expect(redact({
      authorization: 'Bearer eyJhbGciOi...',
      cookie: 'session=abc',
      phone: '+919876543210',
      otp: '123456',
      razorpay_signature: 'sig_abc',
      bookingId: 'b-1',
    })).toEqual({
      authorization: '[redacted]',
      cookie: '[redacted]',
      phone: '[redacted]',
      otp: '[redacted]',
      razorpay_signature: '[redacted]',
      bookingId: 'b-1',
    });
  });

  it('matches regardless of header casing', () => {
    expect(redact({ Authorization: 'Bearer x', 'X-Api-Key': 'k' }))
      .toEqual({ Authorization: '[redacted]', 'X-Api-Key': '[redacted]' });
  });

  it('reaches nested objects and arrays', () => {
    expect(redact({ req: { headers: { authorization: 'Bearer x' } }, users: [{ phone: '+91' }] }))
      .toEqual({ req: { headers: { authorization: '[redacted]' } }, users: [{ phone: '[redacted]' }] });
  });

  it('leaves primitives and nulls alone', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(null)).toBe(null);
    expect(redact(42)).toBe(42);
  });
});

describe('scrub', () => {
  it('drops the request body entirely, whatever it holds', () => {
    const event = scrub({
      request: {
        headers: { authorization: 'Bearer x' },
        cookies: { s: '1' },
        data: { phone: '+91', otp: '1234' },
      },
    } as any);
    expect(event.request.data).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers.authorization).toBe('[redacted]');
  });

  it('scrubs extra and contexts, where our own code attaches detail', () => {
    const event = scrub({ extra: { token: 'abc' }, contexts: { user: { phone: '+91' } } } as any);
    expect(event.extra.token).toBe('[redacted]');
    expect(event.contexts.user.phone).toBe('[redacted]');
  });

  it('passes an event with nothing sensitive through unchanged', () => {
    const event = scrub({ request: { headers: { 'content-type': 'application/json' } } } as any);
    expect(event.request.headers['content-type']).toBe('application/json');
  });
});
