import { describe, expect, it } from 'vitest';
import { CATALOG_KEY_REGEX } from '@mpm/shared-types';
import { toCatalogKey } from './catalog-key';

describe('toCatalogKey', () => {
  it('turns a label into a snake_case key', () => {
    expect(toCatalogKey('Needle Size (mm)')).toBe('needle_size_mm');
    expect(toCatalogKey('  RPM  ')).toBe('rpm');
    expect(toCatalogKey('100% Steel')).toBe('steel');
  });

  it('stays within the key rule for long labels', () => {
    const key = toCatalogKey('A very long label that keeps going well past forty characters');
    expect(key.length).toBeLessThanOrEqual(40);
    expect(CATALOG_KEY_REGEX.test(key)).toBe(true);
  });
});
