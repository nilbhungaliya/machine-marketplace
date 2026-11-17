import { describe, it, expect } from 'vitest';
import { resources } from '@/locales';
import { i18n } from '@/lib/i18n';

type Tree = { [k: string]: string | Tree };

function flatten(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (s: string) => (s.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();
const base = (k: string) => k.replace(PLURAL, '');

const en = flatten(resources.en.translation as unknown as Tree);
const others = {
  hi: flatten(resources.hi.translation as unknown as Tree),
  gu: flatten(resources.gu.translation as unknown as Tree),
};
const tables = { en, ...others };

describe.each(Object.entries(others))('locale parity (en vs %s)', (name, other) => {
  it(`every English key has a ${name} key and vice versa`, () => {
    const enBases = new Set(Object.keys(en).map(base));
    const otherBases = new Set(Object.keys(other).map(base));
    expect([...enBases].filter((k) => !otherBases.has(k))).toEqual([]);
    expect([...otherBases].filter((k) => !enBases.has(k))).toEqual([]);
  });

  it(`no ${name} value is empty`, () => {
    expect(Object.entries(other).filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
  });

  it('placeholders match per key', () => {
    const bad = Object.keys(en)
      .filter((k) => k in other)
      .filter((k) => placeholders(en[k]).join() !== placeholders(other[k]).join());
    expect(bad).toEqual([]);
  });
});

describe('locale parity (plurals)', () => {
  it('every plural key has _one and _other in EVERY language', () => {
    const pluralBases = new Set(
      Object.values(tables).flatMap((t) => Object.keys(t)).filter((k) => PLURAL.test(k)).map(base),
    );
    const problems: string[] = [];
    for (const b of pluralBases) {
      for (const [name, table] of Object.entries(tables)) {
        if (!(`${b}_one` in table)) problems.push(`${name}: ${b}_one`);
        if (!(`${b}_other` in table)) problems.push(`${name}: ${b}_other`);
        if (b in table) problems.push(`${name}: ${b} (plain key beside plural forms)`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('plural resolution at runtime', () => {
  it('picks the right form in every language', async () => {
    try {
      expect(i18n.t('common.listingCount', { count: 1 })).toBe('1 listing');
      expect(i18n.t('common.listingCount', { count: 3 })).toBe('3 listings');
      await i18n.changeLanguage('hi');
      expect(i18n.t('common.listingCount', { count: 3 })).toBe('3 लिस्टिंग');
      await i18n.changeLanguage('gu');
      // Gujarati CLDR: "one" covers 0 and 1.
      expect(i18n.t('common.listingCount', { count: 1 })).toBe('1 લિસ્ટિંગ');
      expect(i18n.t('common.listingCount', { count: 3 })).toBe('3 લિસ્ટિંગ');
    } finally {
      // A failure here must not leave the next test running in another language.
      await i18n.changeLanguage('en');
    }
  });
});
