import { describe, expect, it } from 'vitest';
import { AppError, PayloadTooLargeError, ServiceUnavailableError, TooManyRequestsError } from './errors.js';

describe('error classes added for F1 + A2', () => {
  it('TooManyRequestsError is a 429 with the given code', () => {
    const err = new TooManyRequestsError('Try again tomorrow', 'GST_LOOKUP_LIMIT');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('GST_LOOKUP_LIMIT');
    expect(err.message).toBe('Try again tomorrow');
    expect(err.name).toBe('TooManyRequestsError');
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
