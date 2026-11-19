import { describe, expect, it } from 'vitest';
import { resources } from '@/locales';
import { F6_ERROR_CODES, F6_ERROR_KEYS, f6ErrorKey } from './f6-errors';

// F6 + F7 spec §18 (plan C0-5): every new error code has copy in en, hi and gu.

const lookup = (lang: 'en' | 'hi' | 'gu', key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), resources[lang].translation);

describe('F6 + F7 errors', () => {
  it.each(F6_ERROR_CODES)('%s has copy in en, hi and gu', (code) => {
    const key = F6_ERROR_KEYS[code]!;
    for (const lang of ['en', 'hi', 'gu'] as const) {
      const text = lookup(lang, key);
      expect(typeof text === 'string' && text.length > 0, `${lang} ${key}`).toBe(true);
    }
  });

  it('maps a code and falls back for anything else', () => {
    const apiError = (code: string) => ({ response: { status: 409, data: { error: 'English', code } } });
    expect(f6ErrorKey(apiError('NOT_YOUR_TURN'))).toBe('errors.trade.notYourTurn');
    expect(f6ErrorKey(apiError('LISTING_NOT_FOUND'))).toBe('listing.errors.notFound');
    expect(f6ErrorKey(apiError('SOMETHING_ELSE'))).toBe('errors.genericRetry');
  });
});
