import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { classifyLoadError } from './load-error';

describe('classifyLoadError', () => {
  it('404 is not_found', () => {
    expect(classifyLoadError(new ApiError('Not found', 404))).toBe('not_found');
  });

  it('403 is forbidden', () => {
    expect(classifyLoadError(new ApiError('Forbidden', 403, 'FORBIDDEN'))).toBe('forbidden');
  });

  it('any other status is failed', () => {
    expect(classifyLoadError(new ApiError('Boom', 500))).toBe('failed');
    expect(classifyLoadError(new ApiError('Bad', 400))).toBe('failed');
  });

  it('a non-API error is failed', () => {
    expect(classifyLoadError(new TypeError('Failed to fetch'))).toBe('failed');
    expect(classifyLoadError('nope')).toBe('failed');
    expect(classifyLoadError(undefined)).toBe('failed');
  });
});
