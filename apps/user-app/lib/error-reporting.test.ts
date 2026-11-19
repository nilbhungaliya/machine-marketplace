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

describe('redact: the F1 business and GST bodies', () => {
  it('removes GSTIN, PAN, email, names, addresses, location and codes by key', () => {
    expect(redact({
      gstin: '24AAACC1206D1ZM',
      pan: 'AAACC1206D',
      email: 'a@b.c',
      legalName: 'Sample Engineering',
      tradeName: 'Sample Works',
      businessName: 'Sample Works',
      userName: 'Ravi',
      address: { line: 'Plot 4', city: 'Surat' },
      addressLine: 'Plot 4',
      gstAddress: { line: 'Plot 4' },
      lat: 21.1,
      lng: 72.8,
      pincode: '395010',
      code: '123456',
      hint: '98•••••36',
      industrialAreaOther: 'Bhatar',
      officerMessage: 'Send the other page',
      proofId: 'p-1',
      state: 'needs_more',
      os: { name: 'Android' },
    })).toEqual({
      gstin: '[redacted]',
      pan: '[redacted]',
      email: '[redacted]',
      legalName: '[redacted]',
      tradeName: '[redacted]',
      businessName: '[redacted]',
      userName: '[redacted]',
      address: '[redacted]',
      addressLine: '[redacted]',
      gstAddress: '[redacted]',
      lat: '[redacted]',
      lng: '[redacted]',
      pincode: '[redacted]',
      code: '[redacted]',
      hint: '[redacted]',
      industrialAreaOther: '[redacted]',
      officerMessage: '[redacted]',
      proofId: 'p-1',
      state: 'needs_more',
      os: { name: 'Android' },
    });
  });
});

describe('redact: discovery (F4 + F5 spec §11)', () => {
  it('removes the origin and the query text by key', () => {
    expect(redact({
      q: 'tie rod end 9825041736',
      origin: { point: { lat: 22.3, lng: 70.8 }, fallback: { pincode: '360003' } },
      filters: { side: 'left' },
      sort: 'nearest',
    })).toEqual({ q: '[redacted]', origin: '[redacted]', filters: { side: 'left' }, sort: 'nearest' });
  });
});

describe('scrubEvent', () => {
  it('strips the query string from the request URL', () => {
    const e = scrubEvent({ request: { url: 'https://api.example/locations/nearest-pincode?lat=21.1&lng=72.8' } });
    expect(e.request.url).toBe('https://api.example/locations/nearest-pincode');
  });

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

  it('strips query strings from breadcrumb URLs: the location and signed upload URLs', () => {
    const near = scrubBreadcrumb({ category: 'xhr', data: { url: '/locations/nearest-pincode?lat=21.1&lng=72.8', method: 'GET' } });
    expect(near.data.url).toBe('/locations/nearest-pincode');
    expect(near.data.method).toBe('GET');
    const put = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://acc.r2.cloudflarestorage.com/bucket/incoming-verification/b/u/f.pdf?X-Amz-Signature=abc&X-Amz-Credential=k' },
    });
    expect(put.data.url).toBe('https://acc.r2.cloudflarestorage.com/bucket/incoming-verification/b/u/f.pdf');
    const nav = scrubBreadcrumb({ category: 'navigation', data: { from: '/a?x=1', to: '/b?y=2' } });
    expect(nav.data).toEqual({ from: '/a', to: '/b' });
    const message = scrubBreadcrumb({ category: 'xhr', message: 'GET /locations/nearest-pincode?lat=1&lng=2 [200]' });
    expect(message.message).toBe('GET /locations/nearest-pincode [200]');
  });
});
