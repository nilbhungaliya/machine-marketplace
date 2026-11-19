import type { SearchScript, SearchSide } from '@mpm/shared-types';
import { normalizeSearchText } from '../../services/discovery/normalize.js';
import { DEFAULT_STOP_WORDS } from '../../services/discovery/query-reader.js';
import { scriptOf } from '../../services/discovery/synonym-admin.service.js';

// The search seed (F4 + F5 spec §5.3, §7.1; plan B2-3): side words in English, Hindi and Gujarati (R9: admin-managed
// synonyms with target `side`), machine-parts word synonyms (abbreviations, spellings, Hindi and Gujarati names of
// common parts) and the stop words. A word synonym ADDS its words (amended 2026-11-19): "fender" finds listings with
// "fender" or "mudguard". Pure renames go both ways; abbreviations one way. `pnpm --filter @mpm/api db:seed:search`
// loads them once; the category manager edits them in the admin panel afterwards. No single letters and no "set" among the side words: they would misfire.

/** Side words (§5.3 step 5). */
export const SIDE_WORDS: Record<SearchSide, readonly string[]> = {
  left: [
    'left', 'lh', 'l h', 'left hand', 'left side',
    'लेफ्ट', 'लेफ़्ट', 'बायाँ', 'बायां', 'बाएँ', 'बाएं',
    'લેફ્ટ', 'ડાબું', 'ડાબી', 'ડાબો',
  ],
  right: [
    'right', 'rh', 'r h', 'right hand', 'right side',
    'राइट', 'दायाँ', 'दायां', 'दाएँ', 'दाएं',
    'રાઇટ', 'જમણું', 'જમણી', 'જમણો',
  ],
  pair: ['pair', 'जोड़ी', 'जोड़ा', 'જોડી'],
};

/** Word synonyms (§5.3 step 2): the term is replaced by the words. */
export const WORD_SYNONYMS: ReadonlyArray<readonly [term: string, words: string]> = [
  // Abbreviations and spellings mechanics type.
  ['TRE', 'tie rod end'],
  ['tierod', 'tie rod'],
  ['tie rod', 'tierod'],
  ['fender', 'mudguard'],
  ['mudguard', 'fender'],
  ['bush', 'bushing'],
  ['bushing', 'bush'],
  ['brg', 'bearing'],
  ['cyl', 'cylinder'],
  ['hyd', 'hydraulic'],
  ['assy', 'assembly'],
  ['asy', 'assembly'],
  ['eng', 'engine'],
  ['gearbox', 'gear box'],
  ['gear box', 'gearbox'],
  ['diff', 'differential'],
  ['propshaft', 'propeller shaft'],
  ['propeller shaft', 'propshaft'],
  ['ujoint', 'universal joint'],
  ['universal joint', 'ujoint'],
  ['alt', 'alternator'],
  ['rad', 'radiator'],
  ['carb', 'carburettor'],
  ['carburetor', 'carburettor'],
  ['carburettor', 'carburetor'],
  ['pully', 'pulley'],
  ['bkt', 'bucket'],
  ['oring', 'o ring'],
  ['o ring', 'oring'],
  ['emb', 'embroidery'],
  ['embroidary', 'embroidery'],
  ['wjl', 'water jet loom'],
  ['ajl', 'air jet loom'],
  // Hindi.
  ['गियर', 'gear'],
  ['बेयरिंग', 'bearing'],
  ['बियरिंग', 'bearing'],
  ['बेअरिंग', 'bearing'],
  ['मोटर', 'motor'],
  ['पंप', 'pump'],
  ['पम्प', 'pump'],
  ['सुई', 'needle'],
  ['पाइप', 'pipe'],
  ['सिलेंडर', 'cylinder'],
  // "bush" matches "bush" and "bushing" alike.
  ['बुश', 'bush'],
  ['पिस्टन', 'piston'],
  ['वाल्व', 'valve'],
  ['बेल्ट', 'belt'],
  ['चेन', 'chain'],
  ['इंजन', 'engine'],
  ['फिल्टर', 'filter'],
  ['टायर', 'tyre'],
  ['हाइड्रोलिक', 'hydraulic'],
  // Gujarati.
  ['ગિયર', 'gear'],
  ['બેરિંગ', 'bearing'],
  ['બેયરિંગ', 'bearing'],
  ['મોટર', 'motor'],
  ['પંપ', 'pump'],
  ['સોય', 'needle'],
  ['પાઇપ', 'pipe'],
  ['સિલિન્ડર', 'cylinder'],
  ['બુશ', 'bush'],
  ['પિસ્ટન', 'piston'],
  ['વાલ્વ', 'valve'],
  ['બેલ્ટ', 'belt'],
  ['ચેન', 'chain'],
  ['એન્જિન', 'engine'],
  ['ફિલ્ટર', 'filter'],
  ['ટાયર', 'tyre'],
  ['હાઇડ્રોલિક', 'hydraulic'],
];

/** Stop words (§5.3 step 6), stored in `app_settings` `search.stop_words`. */
export const SEARCH_SEED_STOP_WORDS: readonly string[] = DEFAULT_STOP_WORDS;

export interface SearchSeedRow {
  term: string;
  termNorm: string;
  script: SearchScript;
  targetKind: 'side' | 'word';
  targetSide: SearchSide | null;
  targetWord: string | null;
}

/** The `search_synonyms` rows of the seed (no `created_by`: seeded rows have none). */
export function searchSeedRows(): SearchSeedRow[] {
  const sides = (Object.entries(SIDE_WORDS) as Array<[SearchSide, readonly string[]]>).flatMap(([side, words]) =>
    words.map((term) => ({
      term, termNorm: normalizeSearchText(term), script: scriptOf(term), targetKind: 'side' as const, targetSide: side, targetWord: null,
    })),
  );
  const words = WORD_SYNONYMS.map(([term, target]) => ({
    term, termNorm: normalizeSearchText(term), script: scriptOf(term), targetKind: 'word' as const, targetSide: null,
    targetWord: normalizeSearchText(target),
  }));
  return [...sides, ...words];
}
