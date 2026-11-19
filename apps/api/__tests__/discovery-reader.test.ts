import { describe, expect, it } from 'vitest';
import type { RemovableChip } from '@mpm/shared-types';
import { applyRemovedChips, buildReaderDictionary, readQuery, type ReaderSynonym } from '../src/services/discovery/query-reader.js';

// F4 + F5 spec §5.3, R8 (plan B1-3): the query reader, pure (no database).

const B = { tata: 'b-tata', jcb: 'b-jcb', bull: 'b-bull', komatsu: 'b-komatsu', hitachi: 'b-hitachi', ace: 'b-ace' };
const M = { t1613: 'm-1613', jcb3dx: 'm-3dx', js205: 'm-js205', ex200: 'm-ex200', pc210: 'm-pc210', h450: 'm-h450', k450: 'm-k450', hd76: 'm-hd76' };
const C = {
  gears: 'c-gears',
  backhoe: 'c-backhoe',
  excavator: 'c-excavator',
  pumps: 'c-pumps',
  filtersA: 'c-filters-a',
  filtersB: 'c-filters-b',
  sealsA: 'c-seals-a',
  sealsB: 'c-seals-b',
  construction: 'c-construction',
};

type Syn = Omit<ReaderSynonym, 'termNorm'> & { term: string };
const side = (term: string, s: 'left' | 'right' | 'pair'): Syn => ({ term, kind: 'side', targetId: null, side: s, words: null });
const word = (term: string, words: string): Syn => ({ term, kind: 'word', targetId: null, side: null, words });

const dict = buildReaderDictionary({
  synonyms: [
    ...['left', 'lh', 'l h', 'left hand', 'left side', 'बायाँ', 'बाएं', 'लेफ्ट', 'ડાબું', 'લેફ્ટ'].map((t) => side(t, 'left')),
    ...['right', 'rh', 'r h', 'right hand', 'दायाँ', 'राइट', 'જમણું', 'રાઇટ'].map((t) => side(t, 'right')),
    ...['pair', 'जोड़ी', 'જોડી'].map((t) => side(t, 'pair')),
    word('TRE', 'tie rod end'),
    word('brg', 'bearing'),
    word('गियर', 'gear'),
    word('બેરિંગ', 'bearing'),
    { term: 'टाटा', kind: 'brand', targetId: B.tata, side: null, words: null },
    { term: 'jcb machine', kind: 'category', targetId: C.backhoe, side: null, words: null },
  ],
  brands: [
    { id: B.tata, name: 'Tata', chipNeedsContext: false },
    { id: B.jcb, name: 'JCB', chipNeedsContext: false },
    { id: B.bull, name: 'Bull', chipNeedsContext: true },
    { id: B.komatsu, name: 'Komatsu', chipNeedsContext: false },
    { id: B.hitachi, name: 'Hitachi', chipNeedsContext: false },
    { id: B.ace, name: 'ACE', chipNeedsContext: true },
  ],
  models: [
    { id: M.t1613, name: '1613', brandId: B.tata },
    { id: M.jcb3dx, name: '3DX', brandId: B.jcb },
    { id: M.js205, name: 'JS205', brandId: B.jcb },
    { id: M.ex200, name: 'EX200', brandId: B.hitachi },
    { id: M.pc210, name: 'PC210', brandId: B.komatsu },
    { id: M.h450, name: '450', brandId: B.hitachi },
    { id: M.k450, name: '450', brandId: B.komatsu },
    { id: M.hd76, name: 'HD 76', brandId: B.bull },
  ],
  categories: [
    { id: C.gears, name: 'Gears', level: 'part_group', liveCount: 5 },
    { id: C.backhoe, name: 'Backhoe Loader', level: 'machine_type', liveCount: 30 },
    { id: C.excavator, name: 'Excavator', level: 'machine_type', liveCount: 40 },
    { id: C.pumps, name: 'Hydraulic Pumps', level: 'part_group', liveCount: 8 },
    { id: C.filtersA, name: 'Filters', level: 'part_group', liveCount: 3 },
    { id: C.filtersB, name: 'Filters', level: 'part_group', liveCount: 3 },
    { id: C.sealsA, name: 'Seals', level: 'part_group', liveCount: 2 },
    { id: C.sealsB, name: 'Seals', level: 'part_group', liveCount: 9 },
    { id: C.construction, name: 'Construction Equipment', level: 'machine_category', liveCount: 100 },
  ],
});

const read = (q: string) => readQuery(q, dict);
const readRemoving = (q: string, removed: RemovableChip[]) => applyRemovedChips(read(q), removed);

describe('readQuery', () => {
  describe('#ref', () => {
    it.each([
      ['#100123', 100123, []],
      ['#100123 pump', 100123, ['pump']],
      ['pump #100123', 100123, ['pump']],
    ])('%s → ref', (q, ref, words) => {
      const r = read(q);
      expect(r.ref).toBe(ref);
      expect(r.words).toEqual(words);
      expect(r.partNumbers).toEqual([]);
    });

    it('a bare number is never a ref (the route adds refSuggestion); six digits read as a part number', () => {
      const r = read('100123');
      expect(r.ref).toBeNull();
      expect(r.partNumbers).toEqual(['100123']);
    });

    it('# with letters is not a ref', () => {
      const r = read('#12a');
      expect(r.ref).toBeNull();
      expect(r.words).toEqual(['12a']);
    });
  });

  describe('models before part numbers', () => {
    it.each([
      ['JS205', M.js205],
      ['EX200', M.ex200],
      ['PC210', M.pc210],
      ['js 205', M.js205],
      ['JS-205', M.js205],
    ])('%s → model chip, not a part number', (q, model) => {
      const r = read(q);
      expect(r.model?.id).toBe(model);
      expect(r.partNumbers).toEqual([]);
      expect(r.words).toEqual([]);
    });

    it('PC210 bucket → model + words', () => {
      const r = read('PC210 bucket');
      expect(r.model?.id).toBe(M.pc210);
      expect(r.words).toEqual(['bucket']);
    });

    it('jcb 3dx → brand + model', () => {
      const r = read('jcb 3dx');
      expect(r.brand?.id).toBe(B.jcb);
      expect(r.model?.id).toBe(M.jcb3dx);
    });
  });

  it('tata 1613 tie rod end lh → brand + model + side left + words', () => {
    const r = read('tata 1613 tie rod end lh');
    expect(r.brand).toEqual({ id: B.tata, name: 'Tata' });
    expect(r.model).toEqual({ id: M.t1613, name: '1613', brandId: B.tata });
    expect(r.side).toBe('left');
    expect(r.words).toEqual(['tie', 'rod', 'end']);
  });

  describe('side words', () => {
    it.each([
      ['बायाँ टाई रॉड', 'left', ['टाई', 'रॉड']],
      ['ડાબું', 'left', []],
      ['લેફ્ટ ગિયર', 'left', ['ગિયર']],
      ['दायाँ', 'right', []],
      ['જમણું', 'right', []],
      ['left hand door', 'left', ['door']],
      ['l h mirror', 'left', ['mirror']],
      ['RH mirror', 'right', ['mirror']],
      ['pair', 'pair', []],
      ['जोड़ी', 'pair', []],
      ['lh rh', 'left', []],
    ])('%s → %s', (q, s, words) => {
      const r = read(q);
      expect(r.side).toBe(s);
      expect(r.words).toEqual(words);
    });
  });

  describe('brands that need context', () => {
    it('bull gear stays words (the Gears part group never unlocks Bull)', () => {
      const r = read('bull gear');
      expect(r.brand).toBeNull();
      expect(r.category).toBeNull();
      expect(r.words).toEqual(['bull', 'gear']);
    });

    it('bull gears: the part group is read, Bull stays a word', () => {
      const r = read('bull gears');
      expect(r.brand).toBeNull();
      expect(r.category?.id).toBe(C.gears);
      expect(r.words).toEqual(['bull']);
    });

    it('bull backhoe loader → Bull chip (a machine type unlocks it)', () => {
      const r = read('bull backhoe loader');
      expect(r.brand?.id).toBe(B.bull);
      expect(r.category?.id).toBe(C.backhoe);
      expect(r.words).toEqual([]);
    });

    it('bull hd 76 → Bull chip (a model of the brand unlocks it)', () => {
      const r = read('bull hd 76');
      expect(r.brand?.id).toBe(B.bull);
      expect(r.model?.id).toBe(M.hd76);
    });

    it('ace alone stays a word', () => {
      expect(read('ace').brand).toBeNull();
      expect(read('ace').words).toEqual(['ace']);
    });
  });

  describe('synonyms', () => {
    // Amended 2026-11-19: a word synonym adds its words; it doesn't replace the typed ones.
    it('TRE → a group: "tre" OR "tie rod end"', () => {
      const r = read('TRE');
      expect(r.words).toEqual([]);
      expect(r.wordGroups).toEqual([{ typed: ['tre'], alternatives: [['tie', 'rod', 'end']] }]);
    });

    it('tre lh → a group + side', () => {
      const r = read('tre lh');
      expect(r.wordGroups).toEqual([{ typed: ['tre'], alternatives: [['tie', 'rod', 'end']] }]);
      expect(r.words).toEqual([]);
      expect(r.side).toBe('left');
    });

    it('Hindi and Gujarati word synonyms', () => {
      expect(read('गियर').wordGroups).toEqual([{ typed: ['गियर'], alternatives: [['gear']] }]);
      const r = read('બેરિંગ 6205');
      expect(r.wordGroups).toEqual([{ typed: ['બેરિંગ'], alternatives: [['bearing']] }]);
      expect(r.words).toEqual(['6205']);
    });

    it('a term with several word targets keeps them all; a repeated term is one group', () => {
      const d = buildReaderDictionary({
        synonyms: [word('bush', 'bushing'), word('bush', 'bush sleeve'), word('bush', 'bush')],
        brands: [], models: [], categories: [],
      });
      const r = readQuery('bush bush pin', d);
      expect(r.wordGroups).toEqual([{ typed: ['bush'], alternatives: [['bush', 'sleeve'], ['bushing']] }]);
      expect(r.words).toEqual(['pin']);
    });

    it('groups count toward the 10-word cap', () => {
      const r = read('tre alpha beta gamma delta epsilon zeta eta theta iota kappa');
      expect(r.wordGroups).toHaveLength(1);
      expect(r.words).toHaveLength(9);
    });

    it('a brand synonym reads the brand', () => {
      expect(read('टाटा पंप').brand?.id).toBe(B.tata);
    });

    it('a category synonym reads the category', () => {
      expect(read('jcb machine').category?.id).toBe(C.backhoe);
    });

    it('words a synonym puts in are never a part number', () => {
      expect(read('brg').partNumbers).toEqual([]);
    });
  });

  describe('ambiguity', () => {
    it('a model shared by two brands with no brand read stays words', () => {
      const r = read('450 bucket');
      expect(r.model).toBeNull();
      expect(r.words).toEqual(['450', 'bucket']);
    });

    it("a model of another brand than the one read stays words (\"jcb pc210\")", () => {
      const r = read('jcb pc210');
      expect(r.brand?.id).toBe(B.jcb);
      expect(r.model).toBeNull();
      expect(r.partNumbers).toEqual([]);
      expect(r.words).toEqual(['pc210']);
    });

    it('the read brand picks the model', () => {
      const r = read('komatsu 450');
      expect(r.brand?.id).toBe(B.komatsu);
      expect(r.model?.id).toBe(M.k450);
    });

    it('a category tie with equal counts → none', () => {
      const r = read('filters');
      expect(r.category).toBeNull();
      expect(r.words).toEqual(['filters']);
    });

    it('a category tie is broken by the most public listings', () => {
      expect(read('seals').category?.id).toBe(C.sealsB);
    });

    it('the deepest category wins; the other goes back to words', () => {
      const r = read('hydraulic pumps excavator');
      expect(r.category?.id).toBe(C.pumps);
      expect(r.words).toEqual(['excavator']);
    });

    it('a machine category is read when nothing deeper is', () => {
      expect(read('construction equipment').category?.level).toBe('machine_category');
    });
  });

  describe('part numbers', () => {
    it.each([
      ['10 hp motor', ['10', 'hp', 'motor']],
      ['500 mm roller', ['500', 'mm', 'roller']],
      ['100 kg', ['100', 'kg']],
      ['2 pcs gear', ['2', 'pcs', 'gear']],
    ])('a unit never joins a number across a space: %s', (q, words) => {
      const r = readQuery(q, buildReaderDictionary({ synonyms: [], brands: [], models: [], categories: [], units: ['pcs', 'Pieces'] }));
      expect(r.partNumbers).toEqual([]);
      expect(r.words).toEqual(words);
    });

    it('short letters that are not units still join: "6205 zz", "AB 123 X"', () => {
      expect(read('6205 zz').partNumbers).toEqual(['6205ZZ']);
      expect(read('AB 123 X').partNumbers).toEqual(['AB123X']);
    });

    it.each([
      ['AB-123/X', ['AB123X'], []],
      ['AB 123 X', ['AB123X'], []],
      ['ab123x', ['AB123X'], []],
      ['6205-2RS bearing', ['62052RS'], ['bearing']],
      ['६२०५-२RS', ['62052RS'], []],
      ['12345678', ['12345678'], []],
      ['6205 bearing', [], ['6205', 'bearing']],
      ['m12 bolt', [], ['m12', 'bolt']],
      ['pump 12345', ['12345'], ['pump']],
    ])('%s', (q, pns, words) => {
      const r = read(q);
      expect(r.partNumbers).toEqual(pns);
      expect(r.words).toEqual(words);
    });

    it('at most 3 part numbers; the rest are words', () => {
      const r = read('AA11 BB22 CC33 DD44');
      expect(r.partNumbers).toEqual(['AA11', 'BB22', 'CC33']);
      expect(r.words).toEqual(['dd44']);
    });

    it('a part number next to a side word keeps the side', () => {
      const r = read('AB123 lh');
      expect(r.partNumbers).toEqual(['AB123']);
      expect(r.side).toBe('left');
    });
  });

  describe('stop words and limits', () => {
    it.each([
      ['bearing for jcb', ['bearing']],
      ['seal of the pump', ['seal', 'pump']],
      ['मशीन का पंप', ['मशीन', 'पंप']],
      ['मशीन के लिए तेल', ['मशीन', 'तेल']],
      ['મશીન નું તેલ', ['મશીન', 'તેલ']],
      ['pump ka seal', ['pump', 'seal']],
    ])('%s', (q, words) => {
      expect(read(q).words).toEqual(words);
    });

    it('at most 10 words, duplicates dropped', () => {
      const r = read('aa bb cc dd ee ff gg hh ii jj kk ll aa');
      expect(r.words).toHaveLength(10);
      expect(read('pump pump seal').words).toEqual(['pump', 'seal']);
    });

    it('plain words in Hindi', () => {
      expect(read('हाइड्रोलिक पंप').words).toEqual(['हाइड्रोलिक', 'पंप']);
    });

    it('an empty query', () => {
      const r = read('   ');
      expect(r).toMatchObject({ ref: null, brand: null, model: null, category: null, partNumbers: [], side: null, words: [] });
    });
  });
});

describe('applyRemovedChips', () => {
  it('a removed side chip drops its words entirely', () => {
    const r = readRemoving('tie rod end lh', ['side']);
    expect(r.side).toBeNull();
    expect(r.words).toEqual(['tie', 'rod', 'end']);
  });

  it('a removed brand chip gives its words back', () => {
    const r = readRemoving('tata pump', ['brand']);
    expect(r.brand).toBeNull();
    expect(r.words).toEqual(['pump', 'tata']);
  });

  it('a removed model chip gives its words back', () => {
    const r = readRemoving('EX200 bucket', ['model']);
    expect(r.model).toBeNull();
    expect(r.words).toEqual(['bucket', 'ex200']);
  });

  it('a removed category chip gives its words back', () => {
    const r = readRemoving('seals kit', ['category']);
    expect(r.category).toBeNull();
    expect(r.words).toEqual(['kit', 'seals']);
  });

  it('a removed part-number chip gives its words back', () => {
    const r = readRemoving('AB-123/X', ['partNumber']);
    expect(r.partNumbers).toEqual([]);
    expect(r.words).toEqual(['ab', '123', 'x']);
  });

  it('nothing removed → the same reading', () => {
    const r = read('tata pump');
    expect(applyRemovedChips(r, [])).toBe(r);
  });
});
