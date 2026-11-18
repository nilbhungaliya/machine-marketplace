import { describe, expect, it } from 'vitest';
import { AppError, ConflictError, PayloadTooLargeError, ServiceUnavailableError, TooManyRequestsError } from './errors.js';

describe('error classes added for F1 + A2', () => {
  it('TooManyRequestsError is a 429 with the given code', () => {
    const err = new TooManyRequestsError('Try again tomorrow', 'GST_LOOKUP_LIMIT');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('GST_LOOKUP_LIMIT');
    expect(err.message).toBe('Try again tomorrow');
    expect(err.name).toBe('TooManyRequestsError');
    expect(err.details).toBeUndefined();
  });

  it('TooManyRequestsError carries optional details (retryAt)', () => {
    const err = new TooManyRequestsError('Wait', 'GST_OTP_TOO_SOON', { retryAt: '2026-11-18T10:00:30.000Z' });
    expect(err.details).toEqual({ retryAt: '2026-11-18T10:00:30.000Z' });
  });

  it('ServiceUnavailableError is a 503 with the given code', () => {
    const err = new ServiceUnavailableError('Storage is not configured', 'STORAGE_UNAVAILABLE');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('PayloadTooLargeError is a 413 with the given code and optional details', () => {
    const err = new PayloadTooLargeError('File too large', 'DOCUMENT_TOO_LARGE', { maxBytes: 10_485_760 });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(413);
    expect(err.code).toBe('DOCUMENT_TOO_LARGE');
    expect(err.details).toEqual({ maxBytes: 10_485_760 });
    expect(new PayloadTooLargeError('x', 'Y').details).toBeUndefined();
  });
});

describe('ConflictError details (F2 spec §14)', () => {
  it('carries optional details with a 409', () => {
    const err = new ConflictError('x', 'C', { a: 1 });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('C');
    expect(err.details).toEqual({ a: 1 });
    expect(new ConflictError('y').details).toBeUndefined();
    expect(new ConflictError('y').code).toBe('CONFLICT');
  });
});
