import { describe, expect, it } from 'vitest';
import { PART_REQUEST_ERROR_CODES } from '@mpm/shared-types';
import { resources } from '@/locales';
import { F8_ERROR_KEYS, f8ErrorKey } from './f8-errors';

// F8 spec §15 (plan C0-5): every part-request error code has copy in en, hi and gu.

const lookup = (lang: 'en' | 'hi' | 'gu', key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), resources[lang].translation);

describe('F8 errors', () => {
  it.each(PART_REQUEST_ERROR_CODES)('%s has copy in en, hi and gu', (code) => {
    const key = F8_ERROR_KEYS[code]!;
    for (const lang of ['en', 'hi', 'gu'] as const) {
      const text = lookup(lang, key);
      expect(typeof text === 'string' && text.length > 0, `${lang} ${key}`).toBe(true);
    }
  });

  it('maps an F8 code, keeps shared codes and falls back for anything else', () => {
    const apiError = (code: string) => ({ response: { status: 409, data: { error: 'English', code } } });
    expect(f8ErrorKey(apiError('PART_REQUEST_OPEN_LIMIT'))).toBe('errors.requests.partRequestOpenLimit');
    expect(f8ErrorKey(apiError('REPLY_EXISTS'))).toBe('errors.requests.replyExists');
    expect(f8ErrorKey(apiError('VIEWER_READ_ONLY'))).toBe('errors.trade.viewerReadOnly');
    expect(f8ErrorKey(apiError('SOMETHING_ELSE'))).toBe('errors.genericRetry');
  });
});
