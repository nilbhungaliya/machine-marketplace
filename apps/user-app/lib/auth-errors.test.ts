import { describe, it, expect } from 'vitest';
import { authErrorCode, mapAuthError } from './auth-errors';

const apiError = (code: string, error = 'Server text') => ({ code: 'ERR_BAD_REQUEST', response: { data: { code, error } } });

describe('mapAuthError', () => {
  it('translates known API codes, preferring them over the axios code', () => {
    expect(mapAuthError(apiError('OTP_WRONG'))).toBe('That code is incorrect. Check the SMS and try again.');
    expect(mapAuthError(apiError('OTP_EXPIRED'), 'hi')).toBe('यह कोड एक्सपायर हो गया है। नया OTP मँगाएँ।');
  });

  it('maps a network failure', () => {
    expect(mapAuthError({ code: 'ERR_NETWORK' })).toBe('Could not reach the server. Check your connection.');
  });

  it('falls back to the API message, then generic copy', () => {
    expect(mapAuthError(apiError('SOMETHING_NEW', 'Custom'))).toBe('Custom');
    expect(mapAuthError({})).toBe('Something went wrong. Please try again.');
  });
});

describe('authErrorCode', () => {
  it('returns the API code, else the axios code, else UNKNOWN', () => {
    expect(authErrorCode(apiError('OTP_WRONG'))).toBe('OTP_WRONG');
    expect(authErrorCode({ code: 'ERR_NETWORK' })).toBe('ERR_NETWORK');
    expect(authErrorCode({})).toBe('UNKNOWN');
  });
});
