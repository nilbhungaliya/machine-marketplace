import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { charLength, compactPartNumber, normalizeSearchText, searchTokens } from '../src/services/discovery/normalize.js';

// F4 + F5 spec §5.1 (plan B1-1): the TypeScript normaliser and its SQL twin `mpm_normalize_search` give the same string.

const ZWJ = '‍';
const ZWNJ = '‌';
const SHY = '­';

/** 40 strings: Latin accents, Hindi with nukta and virama, Gujarati, ZWJ / ZWNJ inside words, digits in three scripts. */
const TWINS: string[] = [
  'Hydraulic Pump',
  '  Tie-Rod   End (LH) ',
  'AB-123/X',
  'Café Crème Brûlée',
  'Señor Niño Ångström',
  'Müller GmbH – Zahnrad',
  'Ｆｕｌｌｗｉｄｔｈ ＡＢＣ１２３', // NFKD folds full-width forms
  'ﬁlter ﬂange', // ligatures
  'ÀÉÎÕÜ àéîõü',
  'naïve façade coöperate',
  'बायाँ टाई रॉड',
  'दायाँ',
  'जोड़ी', // nukta, precomposed (U+095C)
  'जोड़ी', // nukta, decomposed (ड + ़)
  'क़िला ग़ज़ल फ़्रेम', // nukta letters
  'हाइड्रोलिक पंप', // virama
  'लेफ्ट',
  'लेफ़्ट',
  'बाएँ बाएं',
  `कि${ZWJ}ट`, // ZWJ inside a word
  `क्${ZWNJ}ष`, // ZWNJ after virama
  `हाइड्रो${ZWNJ}लिक`,
  'ડાબું જમણું',
  'જોડી',
  'લેફ્ટ રાઇટ',
  `ડા${ZWJ}બું`,
  'બેરિંગ ૬૨૦૫',
  'गियर ६२०५ बेयरिंग',
  '०१२३४५६७८९',
  '૦૧૨૩૪૫૬૭૮૯',
  'Part 6205-2RS / ६२०५ / ૬૨૦૫',
  'मशीन। पुर्जा॥ अंत',
  `soft${SHY}hyphen`,
  'e-mail: rahul@gmail.com +91 98765 43210',
  '100% cotton & 50/50 mix',
  'JS205 EX200 PC210',
  'Tata 1613 tie rod end lh',
  'ÇA VA? Ça va!',
  'Ölfilter für Bagger',
  '',
];

describe('normalizeSearchText (twin of mpm_normalize_search)', () => {
  it('has 40 strings', () => {
    expect(TWINS).toHaveLength(40);
  });

  it('gives the same string as the SQL function for every string', async () => {
    const { rows } = await db.execute<{ i: number; out: string | null }>(sql`
      SELECT i::int AS i, mpm_normalize_search(s) AS out
      FROM unnest(${sql.param(TWINS)}::text[]) WITH ORDINALITY AS t(s, i)`);
    expect(rows).toHaveLength(TWINS.length);
    for (const row of rows) {
      const input = TWINS[row.i - 1]!;
      expect({ input, out: normalizeSearchText(input) }).toEqual({ input, out: row.out ?? '' });
    }
  });

  it('keeps Indic vowel signs, virama and nukta; drops Latin accents', () => {
    expect(normalizeSearchText('Café')).toBe('cafe');
    expect(normalizeSearchText('बायाँ')).toBe('बायाँ');
    expect(normalizeSearchText('हाइड्रोलिक')).toBe('हाइड्रोलिक');
    expect(normalizeSearchText('ડાબું')).toBe('ડાબું');
  });

  it('deletes ZWJ / ZWNJ / soft hyphen without splitting the word', () => {
    expect(normalizeSearchText(`हाइड्रो${ZWNJ}लिक`)).toBe('हाइड्रोलिक');
    expect(normalizeSearchText(`soft${SHY}hyphen`)).toBe('softhyphen');
    expect(searchTokens(`ડા${ZWJ}બું`)).toEqual(['ડાબું']);
  });

  it('turns Indic digits into ASCII and the dandas into spaces', () => {
    expect(normalizeSearchText('६२०५ ૬૨૦૫')).toBe('6205 6205');
    expect(normalizeSearchText('मशीन।पुर्जा॥')).toBe('मशीन पुर्जा');
  });

  it('punctuation separates words; spaces collapse', () => {
    expect(normalizeSearchText('  AB-123/X  ')).toBe('ab 123 x');
    expect(searchTokens('')).toEqual([]);
  });

  it('compact part number and character length', () => {
    expect(compactPartNumber('AB-123/X')).toBe('ab123x');
    expect(compactPartNumber(' ab 123 x ')).toBe('ab123x');
    expect(charLength('बायाँ')).toBe(5);
  });
});
