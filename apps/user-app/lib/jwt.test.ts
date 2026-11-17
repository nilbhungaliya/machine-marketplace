import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, isExpired } from './jwt';

const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const token = (payload: object) => `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`;

describe('decodeJwtPayload', () => {
  it('reads a base64url payload', () => {
    expect(decodeJwtPayload(token({ userId: 'u1', businessId: null, exp: 10 }))).toEqual({ userId: 'u1', businessId: null, exp: 10 });
  });

  it('returns null for garbage or a payload without userId', () => {
    expect(decodeJwtPayload('nope')).toBeNull();
    expect(decodeJwtPayload(token({ sub: 'x' }))).toBeNull();
  });
});

describe('isExpired', () => {
  it('compares exp (seconds) against now (ms)', () => {
    expect(isExpired({ userId: 'u', businessId: null, exp: 100 }, 101_000)).toBe(true);
    expect(isExpired({ userId: 'u', businessId: null, exp: 100 }, 99_000)).toBe(false);
    expect(isExpired({ userId: 'u', businessId: null }, 1e15)).toBe(false);
  });
});
