import {
  DISCOVERY_LIMITS,
  PART_NUMBER_MAX,
  normalizePartNumber,
  type CatalogLevel,
  type QueryReading,
  type RemovableChip,
  type SearchSide,
  type SynonymTarget,
  type WordSynonymGroup,
} from '@mpm/shared-types';
import { normalizeSearchText, searchTokens } from './normalize.js';

// The query reader (F4 + F5 spec §5.3, R8): pure, no database. It turns a typed query into removable chips (`#ref`,
// brand, model, category, part numbers, side) and the remaining words, in this order:
//   1. `#ref`: `#` followed by digits.
//   2. Synonym phrases (longest first, up to 4 words): `word` synonyms make a word group (amended 2026-11-19: a word
//      synonym ADDS its words — the group hits on the words as typed OR on any target's words); category, brand, model
//      and side synonyms mark the phrase as that name / side.
//   3. Names: brands, models (also by their compact form, "js 205" = "js205") and categories. A brand with
//      `chip_needs_context` is a chip only when a model of that brand or a machine type is read too. A model whose
//      brand was read wins; a model name shared by brands with none read stays words. Categories: deepest level first,
//      then the most public listings, still tied → none. Tokens consumed here are never part numbers.
//   4. Part numbers among the free tokens: a run (one typed chunk such as "AB-123/X", or pieces typed with spaces where
//      one side is one or two letters or both are digits, such as "AB 123 X") with a letter and a digit, or ≥ 5
//      digits, at least 4 characters after F2's part-number normaliser; at most 3.
//   5. Side words: the first side synonym wins; side words never become words.
//   6. Remaining words: stop words dropped, duplicates dropped, at most 10 together with the word groups.

export interface ReaderSynonym {
  termNorm: string;
  kind: SynonymTarget;
  targetId: string | null;
  side: SearchSide | null;
  /** `word` targets: the normalised replacement words. */
  words: string | null;
}

export interface ReaderCategory {
  id: string;
  name: string;
  level: CatalogLevel;
  /** Public listings in the node and its descendants (the tie-break). */
  liveCount: number;
}

export interface ReaderBrand {
  id: string;
  name: string;
  chipNeedsContext: boolean;
}

export interface ReaderModel {
  id: string;
  name: string;
  brandId: string;
}

export interface ReaderDictionary {
  synonyms: Map<string, ReaderSynonym[]>;
  categories: Map<string, ReaderCategory[]>;
  brands: Map<string, ReaderBrand[]>;
  models: Map<string, ReaderModel[]>;
  /** Models by their normalised name without spaces. */
  modelsCompact: Map<string, ReaderModel[]>;
  categoryById: Map<string, ReaderCategory>;
  brandById: Map<string, ReaderBrand>;
  modelById: Map<string, ReaderModel>;
  stopWords: Set<string>;
  /** Unit words (units table keys and labels, plus common symbols): never joined into a part number across a space. */
  units: Set<string>;
  /** Longest name / synonym phrase in words (capped). */
  maxNameWords: number;
  maxSynonymWords: number;
}

/** Built-in stop words (§5.3 step 6) used until `app_settings` `search.stop_words` holds the admin's list (B2 seed). */
/** Unit symbols always treated as units (§5.3 step 4), besides the units table's keys and labels. */
export const DEFAULT_UNIT_WORDS: readonly string[] = ['hp', 'kw', 'mm', 'cm', 'kg', 'v'];

export const DEFAULT_STOP_WORDS: readonly string[] = [
  'a', 'an', 'the', 'for', 'of', 'and', 'with', 'in', 'on', 'to', 'or', 'by',
  'ka', 'ki', 'ke', 'ko', 'se', 'aur', 'wala', 'wali', 'wale',
  'का', 'की', 'के', 'को', 'से', 'में', 'और', 'लिए', 'वाला', 'वाली', 'वाले',
  'નું', 'ની', 'ના', 'નો', 'નાં', 'માટે', 'અને', 'થી', 'માં', 'વાળું', 'વાળી', 'વાળો',
];

const MAX_NAME_WORDS = 6;
const compact = (s: string): string => s.replace(/ /g, '');

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Builds the reader's lookup tables from plain rows (names are normalised here). */
export function buildReaderDictionary(input: {
  synonyms: Array<Omit<ReaderSynonym, 'termNorm'> & { term: string }>;
  categories: ReaderCategory[];
  brands: ReaderBrand[];
  models: ReaderModel[];
  stopWords?: readonly string[];
  /** Unit keys and labels from the units table. */
  units?: readonly string[];
}): ReaderDictionary {
  const dict: ReaderDictionary = {
    synonyms: new Map(),
    categories: new Map(),
    brands: new Map(),
    models: new Map(),
    modelsCompact: new Map(),
    categoryById: new Map(),
    brandById: new Map(),
    modelById: new Map(),
    stopWords: new Set((input.stopWords ?? DEFAULT_STOP_WORDS).map((w) => normalizeSearchText(w)).filter((w) => w !== '')),
    units: new Set([...DEFAULT_UNIT_WORDS, ...(input.units ?? [])].map((w) => normalizeSearchText(w)).filter((w) => w !== '' && !w.includes(' '))),
    maxNameWords: 1,
    maxSynonymWords: 1,
  };
  const words = (s: string) => (s === '' ? 0 : s.split(' ').length);
  for (const s of input.synonyms) {
    const termNorm = normalizeSearchText(s.term);
    if (termNorm === '' || words(termNorm) > DISCOVERY_LIMITS.maxSynonymPhraseWords) continue;
    push(dict.synonyms, termNorm, { ...s, termNorm, words: s.words === null ? null : normalizeSearchText(s.words) });
    dict.maxSynonymWords = Math.max(dict.maxSynonymWords, words(termNorm));
  }
  const nameWords = (norm: string) => {
    dict.maxNameWords = Math.min(MAX_NAME_WORDS, Math.max(dict.maxNameWords, words(norm)));
  };
  for (const c of input.categories) {
    const norm = normalizeSearchText(c.name);
    dict.categoryById.set(c.id, c);
    if (norm === '') continue;
    push(dict.categories, norm, c);
    nameWords(norm);
  }
  for (const b of input.brands) {
    const norm = normalizeSearchText(b.name);
    dict.brandById.set(b.id, b);
    if (norm === '') continue;
    push(dict.brands, norm, b);
    nameWords(norm);
  }
  for (const m of input.models) {
    const norm = normalizeSearchText(m.name);
    dict.modelById.set(m.id, m);
    if (norm === '') continue;
    push(dict.models, norm, m);
    if (compact(norm).length >= 2) push(dict.modelsCompact, compact(norm), m);
    nameWords(norm);
  }
  return dict;
}

/** What the reader returns: the reading plus the words each removable chip took (to give them back, §5.3). */
export interface ReadQueryResult extends QueryReading {
  chipWords: Record<Exclude<RemovableChip, 'side'>, string[]>;
}

interface Tok {
  text: string;
  /** Index of the whitespace-separated chunk it was typed in; -1 for words a synonym put in. */
  chunk: number;
  /** Consumed by a name (also when given back as words) or put in by a synonym: never a part number. */
  noPartNumber: boolean;
}

type Item =
  | { kind: 'tok'; tok: Tok }
  | { kind: 'side'; toks: Tok[]; side: SearchSide }
  | { kind: 'group'; toks: Tok[]; alternatives: string[][] }
  | { kind: 'name'; toks: Tok[]; brands: ReaderBrand[]; models: ReaderModel[]; categories: ReaderCategory[] };

const REF_RE = /(^|\s)#(\d{1,15})(?=\s|$)/;
const LEVEL_DEPTH: Record<CatalogLevel, number> = { machine_category: 0, machine_type: 1, part_group: 2 };

function uniqById<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** Step 2: synonym phrases, longest first. */
function applySynonyms(toks: Tok[], dict: ReaderDictionary): Item[] {
  const items: Item[] = [];
  const maxN = Math.min(dict.maxSynonymWords, DISCOVERY_LIMITS.maxSynonymPhraseWords);
  for (let i = 0; i < toks.length; ) {
    let matched = false;
    for (let n = Math.min(maxN, toks.length - i); n >= 1; n--) {
      const slice = toks.slice(i, i + n);
      const targets = dict.synonyms.get(slice.map((t) => t.text).join(' '));
      if (!targets?.length) continue;
      const side = targets.find((t) => t.kind === 'side' && t.side);
      const names = targets.filter((t) => t.kind === 'category' || t.kind === 'brand' || t.kind === 'model');
      const typed = slice.map((t) => t.text).join(' ');
      const alternatives = [...new Set(targets.filter((t) => t.kind === 'word' && t.words).map((t) => t.words!))]
        .filter((w) => w !== typed)
        .sort()
        .map((w) => w.split(' ').filter((x) => x !== ''))
        .filter((ws) => ws.length > 0);
      if (side) {
        items.push({ kind: 'side', toks: slice, side: side.side! });
      } else if (names.length) {
        const pick = <T>(kind: SynonymTarget, byId: Map<string, T>): T[] =>
          names.filter((t) => t.kind === kind && t.targetId && byId.has(t.targetId)).map((t) => byId.get(t.targetId!)!);
        const item: Item = {
          kind: 'name',
          toks: slice,
          brands: uniqById(pick('brand', dict.brandById)),
          models: uniqById(pick('model', dict.modelById)),
          categories: uniqById(pick('category', dict.categoryById)),
        };
        if (item.brands.length + item.models.length + item.categories.length === 0) continue;
        items.push(item);
      } else if (alternatives.length) {
        items.push({ kind: 'group', toks: slice, alternatives });
      } else {
        continue;
      }
      i += n;
      matched = true;
      break;
    }
    if (!matched) {
      items.push({ kind: 'tok', tok: toks[i]! });
      i += 1;
    }
  }
  return items;
}

/** Step 3a: phrases of free tokens that name a brand, a model or a category, longest first. */
function findNames(items: Item[], dict: ReaderDictionary): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < items.length; ) {
    const run: Tok[] = [];
    for (let j = i; j < items.length && items[j]!.kind === 'tok' && run.length < dict.maxNameWords; j++) run.push((items[j] as { tok: Tok }).tok);
    let matched = false;
    for (let n = run.length; n >= 1; n--) {
      const slice = run.slice(0, n);
      const phrase = slice.map((t) => t.text).join(' ');
      const brands = dict.brands.get(phrase) ?? [];
      const models = uniqById([...(dict.models.get(phrase) ?? []), ...(n <= 3 ? (dict.modelsCompact.get(compact(phrase)) ?? []) : [])]);
      const categories = dict.categories.get(phrase) ?? [];
      if (brands.length + models.length + categories.length === 0) continue;
      out.push({ kind: 'name', toks: slice, brands, models, categories });
      i += n;
      matched = true;
      break;
    }
    if (!matched) {
      out.push(items[i]!);
      i += 1;
    }
  }
  return out;
}

const back = (toks: Tok[]): Item[] => toks.map((t) => ({ kind: 'tok' as const, tok: { ...t, noPartNumber: true } }));

/** Step 4: part numbers among free tokens. A fragment is short letters (≤ 2) or a token with a digit. */
function readPartNumbers(items: Item[], dict: ReaderDictionary): { items: Item[]; partNumbers: Array<{ norm: string; words: string[] }> } {
  const isAlnum = (t: Tok) => /^[a-z0-9]+$/.test(t.text);
  const shortLetters = (t: Tok) => /^[a-z]{1,2}$/.test(t.text);
  const digits = (t: Tok) => /^\d+$/.test(t.text);
  const unit = (t: Tok) => /^[a-z]+$/.test(t.text) && dict.units.has(t.text);
  // Across a space, only short pieces join ("AB 123 X", "6205 zz", "12 345 678"); two full codes ("AA11 BB22") stay
  // apart, and a unit never joins ("10 hp", "500 mm", "100 kg").
  const joinsAcrossSpace = (a: Tok, b: Tok) =>
    !unit(a) && !unit(b) && (shortLetters(a) || shortLetters(b) || (digits(a) && digits(b)));
  const candidate = (it: Item | undefined): Tok | null =>
    it && it.kind === 'tok' && !it.tok.noPartNumber && isAlnum(it.tok) && !dict.stopWords.has(it.tok.text) ? it.tok : null;

  const out: Item[] = [];
  const partNumbers: Array<{ norm: string; words: string[] }> = [];
  for (let i = 0; i < items.length; ) {
    const first = candidate(items[i]);
    if (!first) {
      out.push(items[i]!);
      i += 1;
      continue;
    }
    const group: Tok[] = [first];
    let j = i + 1;
    for (; j < items.length; j++) {
      const next = candidate(items[j]);
      const prev = group[group.length - 1]!;
      if (!next) break;
      const sameChunk = next.chunk === prev.chunk && next.chunk >= 0;
      if (!sameChunk && !joinsAcrossSpace(prev, next)) break;
      group.push(next);
    }
    const norm = normalizePartNumber(group.map((t) => t.text).join(''));
    const hasLetter = /[A-Z]/.test(norm);
    const hasDigit = /\d/.test(norm);
    const qualifies =
      norm.length >= 4 && norm.length <= PART_NUMBER_MAX && ((hasLetter && hasDigit) || (!hasLetter && norm.length >= 5));
    if (qualifies && partNumbers.length < DISCOVERY_LIMITS.maxPartNumbers && !partNumbers.some((p) => p.norm === norm)) {
      partNumbers.push({ norm, words: group.map((t) => t.text) });
    } else {
      for (const t of group) out.push({ kind: 'tok', tok: t });
    }
    i = j;
  }
  return { items: out, partNumbers };
}

/** Reads a query (§5.3). Pure: the dictionary comes from `loadReaderDictionary`. */
export function readQuery(raw: string | null | undefined, dict: ReaderDictionary): ReadQueryResult {
  let text = raw ?? '';
  let ref: number | null = null;
  const refMatch = REF_RE.exec(text);
  if (refMatch) {
    ref = Number(refMatch[2]);
    text = `${text.slice(0, refMatch.index)}${refMatch[1]} ${text.slice(refMatch.index + refMatch[0].length)}`;
  }

  // Tokens, each with the whitespace chunk it was typed in ("AB-123/X" is one chunk of three tokens).
  const toks: Tok[] = [];
  text
    .split(/\s+/)
    .filter((c) => c !== '')
    .forEach((chunk, ci) => {
      for (const t of searchTokens(chunk)) toks.push({ text: t, chunk: ci, noPartNumber: false });
    });

  // 2. Synonyms; 3. names.
  let items = findNames(applySynonyms(toks, dict), dict);

  // 3b. Resolve the names: brand, then model (its brand wins), then category (deepest, most listings), then the
  // brand's context rule. What isn't kept goes back to words.
  const names = items.filter((it): it is Extract<Item, { kind: 'name' }> => it.kind === 'name');
  let brandItem: (typeof names)[number] | null = null;
  let brand: ReaderBrand | null = null;
  for (const it of names) {
    const distinct = uniqById(it.brands);
    if (distinct.length === 1 && !brandItem) {
      brandItem = it;
      brand = distinct[0]!;
    }
  }
  let modelItem: (typeof names)[number] | null = null;
  let model: ReaderModel | null = null;
  for (const it of names) {
    if (it === brandItem || it.models.length === 0 || modelItem) continue;
    // With a brand read, only that brand's models count ("jcb pc210": PC210 is Komatsu's, so it stays words).
    const ofBrand = brand ? it.models.filter((m) => m.brandId === brand!.id) : [];
    const chosen = brand ? (ofBrand.length === 1 ? ofBrand[0]! : null) : it.models.length === 1 ? it.models[0]! : null;
    if (chosen) {
      modelItem = it;
      model = chosen;
    }
  }
  let categoryItem: (typeof names)[number] | null = null;
  let category: ReaderCategory | null = null;
  const categoryItems = names.filter((it) => it !== brandItem && it !== modelItem && it.categories.length > 0);
  const allCategories = categoryItems.flatMap((it) => it.categories.map((c) => ({ it, c })));
  if (allCategories.length) {
    const deepest = Math.max(...allCategories.map(({ c }) => LEVEL_DEPTH[c.level]));
    let tied = allCategories.filter(({ c }) => LEVEL_DEPTH[c.level] === deepest);
    const uniqueNodes = uniqById(tied.map(({ c }) => c));
    if (uniqueNodes.length > 1) {
      const most = Math.max(...uniqueNodes.map((c) => c.liveCount));
      tied = tied.filter(({ c }) => c.liveCount === most);
    }
    if (uniqById(tied.map(({ c }) => c)).length === 1) {
      categoryItem = tied[0]!.it;
      category = tied[0]!.c;
    }
  }
  const machineTypeRead = allCategories.some(({ c }) => c.level === 'machine_type');
  if (brand?.chipNeedsContext && !(model?.brandId === brand.id) && !machineTypeRead) {
    brandItem = null;
    brand = null;
  }
  items = items.flatMap((it) => (it.kind === 'name' && it !== brandItem && it !== modelItem && it !== categoryItem ? back(it.toks) : [it]));

  // 4. Part numbers.
  const pn = readPartNumbers(items, dict);
  items = pn.items;

  // 5. Side; 6. words.
  let side: SearchSide | null = null;
  const words: string[] = [];
  const wordGroups: WordSynonymGroup[] = [];
  const full = () => words.length + wordGroups.length >= DISCOVERY_LIMITS.maxWords;
  for (const it of items) {
    if (it.kind === 'side') {
      side ??= it.side;
      continue;
    }
    if (it.kind === 'group') {
      const typed = it.toks.map((t) => t.text);
      if (full() || wordGroups.some((g) => g.typed.join(' ') === typed.join(' '))) continue;
      wordGroups.push({ typed, alternatives: it.alternatives.map((a) => [...a]) });
      continue;
    }
    if (it.kind !== 'tok') continue;
    const w = it.tok.text;
    if (dict.stopWords.has(w) || words.includes(w) || full()) continue;
    words.push(w);
  }

  const wordsOf = (it: { toks: Tok[] } | null) => (it ? it.toks.map((t) => t.text) : []);
  return {
    ref,
    brand: brand ? { id: brand.id, name: brand.name } : null,
    model: model ? { id: model.id, name: model.name, brandId: model.brandId } : null,
    category: category ? { id: category.id, name: category.name, level: category.level } : null,
    partNumbers: pn.partNumbers.map((p) => p.norm),
    side,
    words,
    wordGroups,
    chipWords: {
      brand: wordsOf(brandItem),
      model: wordsOf(modelItem),
      category: wordsOf(categoryItem),
      partNumber: pn.partNumbers.flatMap((p) => p.words),
    },
  };
}

/**
 * Removes chips the buyer took off (§5.3, R8): a removed brand / model / category / part-number chip gives its words
 * back to the word list; a removed side chip drops its side words entirely.
 */
export function applyRemovedChips(reading: ReadQueryResult, removed: readonly RemovableChip[] | null | undefined): ReadQueryResult {
  if (!removed?.length) return reading;
  const out: ReadQueryResult = { ...reading, words: [...reading.words], chipWords: { ...reading.chipWords } };
  const giveBack = (ws: string[]) => {
    for (const w of ws) {
      if (!out.words.includes(w) && out.words.length + out.wordGroups.length < DISCOVERY_LIMITS.maxWords) out.words.push(w);
    }
  };
  if (removed.includes('side')) out.side = null;
  if (removed.includes('brand') && out.brand) {
    giveBack(out.chipWords.brand);
    out.brand = null;
    out.chipWords.brand = [];
  }
  if (removed.includes('model') && out.model) {
    giveBack(out.chipWords.model);
    out.model = null;
    out.chipWords.model = [];
  }
  if (removed.includes('category') && out.category) {
    giveBack(out.chipWords.category);
    out.category = null;
    out.chipWords.category = [];
  }
  if (removed.includes('partNumber') && out.partNumbers.length) {
    giveBack(out.chipWords.partNumber);
    out.partNumbers = [];
    out.chipWords.partNumber = [];
  }
  return out;
}

/** The public reading (no internal chip words). */
export function publicReading(r: ReadQueryResult): QueryReading {
  const { chipWords: _chipWords, ...reading } = r;
  return reading;
}
