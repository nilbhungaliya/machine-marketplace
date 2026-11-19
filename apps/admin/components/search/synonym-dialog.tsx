'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  SYNONYM_TARGETS, type BrandWithModels, type CategoryNode, type SearchSide, type SearchSynonym, type SearchSynonymInput,
  type SynonymTarget,
} from '@mpm/shared-types';
import { SearchableSelect } from '@/components/catalog/searchable-select';
import { Button } from '@/components/ui/button';
import { checkCls, errorCls, inputCls, labelCls } from '@/components/ui/field-classes';
import { FormDialog } from '@/components/ui/form-dialog';
import { fetchAdminBrands, fetchAdminTree } from '@/lib/catalog-api';
import type { NodeChoice } from '@/lib/category-tree';
import {
  SEARCH_SIDE_LABELS, SYNONYM_EXISTS_MESSAGE, SYNONYM_GONE_MESSAGE, TARGET_INVALID_MESSAGE, TARGET_KIND_LABELS,
  createSynonym, explainSearchError, isApiCode, updateSynonym,
} from '@/lib/search-api';

/** The reader matches synonym phrases of up to 4 words (spec §5.3 step 2; the API checks the normalised form too). */
const MAX_TERM_WORDS = 4;
const SIDES: SearchSide[] = ['left', 'right', 'pair'];
const RADIO_CLS = 'h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-600';
// Built with the constructor: the admin's TS target (ES5) refuses the `u` flag on a literal; every browser has it.
const NOT_WORD = new RegExp('[^\\p{L}\\p{M}\\p{N}]+', 'u');
// ZWNJ, ZWJ and soft hyphen are deleted, not spaces (as the API's normaliser, spec §5.1): Indic keyboards put them inside words.
const JOINERS = new RegExp(`[${String.fromCharCode(0x200c, 0x200d, 0xad)}]`, 'g');
const countWords = (s: string) => s.replace(JOINERS, '').split(NOT_WORD).filter(Boolean).length;

const schema = z
  .object({
    term: z.string().trim().min(1, 'Type the term buyers search for').max(100, 'At most 100 characters'),
    targetKind: z.enum(SYNONYM_TARGETS),
    categoryId: z.string(),
    brandId: z.string(),
    modelId: z.string(),
    side: z.string(),
    word: z.string().trim().max(200, 'At most 200 characters'),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.term && countWords(v.term) > MAX_TERM_WORDS) ctx.addIssue({ code: 'custom', path: ['term'], message: `At most ${MAX_TERM_WORDS} words` });
    if (v.targetKind === 'category' && !v.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category' });
    if (v.targetKind === 'brand' && !v.brandId) ctx.addIssue({ code: 'custom', path: ['brandId'], message: 'Choose a brand' });
    if (v.targetKind === 'model' && !v.modelId) ctx.addIssue({ code: 'custom', path: ['modelId'], message: 'Choose a model' });
    if (v.targetKind === 'side' && !SIDES.includes(v.side as SearchSide)) {
      ctx.addIssue({ code: 'custom', path: ['side'], message: 'Choose left, right or pair' });
    }
    if (v.targetKind === 'word' && !v.word) ctx.addIssue({ code: 'custom', path: ['word'], message: 'Type the words to search for' });
  });
type Values = z.infer<typeof schema>;
type TargetField = 'categoryId' | 'brandId' | 'modelId' | 'side' | 'word';

const FIELD_OF: Record<SynonymTarget, TargetField> = {
  category: 'categoryId', brand: 'brandId', model: 'modelId', side: 'side', word: 'word',
};

/** The kind and its one field, as the API takes it. */
function targetOf(v: Values): Pick<SearchSynonymInput, 'targetKind' | 'targetId' | 'targetSide' | 'targetWord'> {
  switch (v.targetKind) {
    case 'category': return { targetKind: 'category', targetId: v.categoryId };
    case 'brand': return { targetKind: 'brand', targetId: v.brandId };
    case 'model': return { targetKind: 'model', targetId: v.modelId };
    case 'side': return { targetKind: 'side', targetSide: v.side as SearchSide };
    case 'word': return { targetKind: 'word', targetWord: v.word.trim() };
  }
}

function sameTarget(v: Values, s: SearchSynonym): boolean {
  if (v.targetKind !== s.targetKind) return false;
  if (v.targetKind === 'side') return v.side === s.targetSide;
  if (v.targetKind === 'word') return v.word.trim() === (s.targetWord ?? '');
  return v[FIELD_OF[v.targetKind]] === s.targetId;
}

/** Every active node (its ancestors active too), at every level, in tree order, labelled with its path. */
function categoryChoices(nodes: CategoryNode[], keep: string | null): NodeChoice[] {
  const out: NodeChoice[] = [];
  const walk = (list: CategoryNode[], names: string[], parentActive: boolean) => {
    for (const n of list) {
      const path = [...names, n.name];
      const active = parentActive && n.isActive;
      if (active || n.id === keep) out.push({ id: n.id, label: path.join(' › '), isActive: active });
      walk(n.children, path, active);
    }
  };
  walk(nodes, [], true);
  return out;
}

function brandChoices(brands: BrandWithModels[], keep: string | null): NodeChoice[] {
  return brands.filter((b) => b.isActive || b.id === keep).map((b) => ({ id: b.id, label: b.name, isActive: b.isActive }));
}

function modelChoices(brands: BrandWithModels[], keep: string | null): NodeChoice[] {
  return brands.flatMap((b) =>
    b.models
      .filter((m) => (b.isActive && m.isActive) || m.id === keep)
      .map((m) => ({ id: m.id, label: `${b.name} › ${m.name}`, isActive: b.isActive && m.isActive })),
  );
}

export interface SynonymDialogProps {
  /** Editing this synonym; absent: adding one. */
  synonym?: SearchSynonym;
  /** Adding: the term to start from (Search insights' "Make a synonym"). */
  initialTerm?: string;
  onClose: () => void;
  /** After a save (or when the synonym turned out deleted): the caller reloads and closes. */
  onSaved: () => void;
}

/**
 * Add or edit a search synonym (F4 + F5 spec §4.2, §5.3, §9): the term buyers type, and what it points at: a category
 * (any level), a brand, a model, a side, or words. Words ADD an alternative: search finds listings with the term or with
 * the words. Mount it to open it.
 */
export function SynonymDialog({ synonym, initialTerm, onClose, onSaved }: SynonymDialogProps) {
  const [catalog, setCatalog] = useState<{ tree: CategoryNode[]; brands: BrandWithModels[] } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogError(null);
    try {
      const [tree, brands] = await Promise.all([fetchAdminTree(), fetchAdminBrands()]);
      setCatalog({ tree, brands });
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Could not load the catalogue');
    }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      term: synonym?.term ?? initialTerm ?? '',
      targetKind: synonym?.targetKind ?? 'word',
      categoryId: synonym?.targetKind === 'category' ? synonym.targetId ?? '' : '',
      brandId: synonym?.targetKind === 'brand' ? synonym.targetId ?? '' : '',
      modelId: synonym?.targetKind === 'model' ? synonym.targetId ?? '' : '',
      side: synonym?.targetSide ?? '',
      word: synonym?.targetWord ?? '',
      isActive: synonym?.isActive ?? true,
    },
  });
  const kind = watch('targetKind');
  const keep = synonym?.targetId ?? null;

  const choices = useMemo(() => ({
    category: catalog ? categoryChoices(catalog.tree, keep) : [],
    brand: catalog ? brandChoices(catalog.brands, keep) : [],
    model: catalog ? modelChoices(catalog.brands, keep) : [],
  }), [catalog, keep]);

  const save = async (v: Values) => {
    try {
      if (!synonym) {
        await createSynonym({ term: v.term.trim(), ...targetOf(v), isActive: v.isActive });
        toast.success('Synonym added');
      } else {
        const patch: Partial<SearchSynonymInput> = {};
        if (v.term.trim() !== synonym.term) patch.term = v.term.trim();
        if (!sameTarget(v, synonym)) Object.assign(patch, targetOf(v));
        if (v.isActive !== synonym.isActive) patch.isActive = v.isActive;
        if (Object.keys(patch).length === 0) { onClose(); return; }
        await updateSynonym(synonym.id, patch);
        toast.success('Synonym saved');
      }
      onSaved();
    } catch (err) {
      if (isApiCode(err, 'SYNONYM_EXISTS')) setError('term', { message: SYNONYM_EXISTS_MESSAGE });
      else if (isApiCode(err, 'SYNONYM_TARGET_INVALID')) {
        // A catalogue target went off or away; a side or words refusal says what is wrong in the API's own words.
        const named = v.targetKind === 'category' || v.targetKind === 'brand' || v.targetKind === 'model';
        setError(FIELD_OF[v.targetKind], {
          message: named ? TARGET_INVALID_MESSAGE : (err instanceof Error && err.message) || 'Choose a valid target',
        });
      }
      else if (isApiCode(err, 'VALIDATION_ERROR')) setError('term', { message: explainSearchError(err) });
      else if (isApiCode(err, 'NOT_FOUND')) {
        toast.error(SYNONYM_GONE_MESSAGE);
        onSaved();
      } else toast.error(explainSearchError(err, 'Could not save the synonym'));
    }
  };

  const picker = (field: 'categoryId' | 'brandId' | 'modelId', label: string, list: NodeChoice[]) => (
    <div>
      <SearchableSelect
        id={`synonym-${field}`}
        label={label}
        choices={list}
        value={watch(field)}
        onChange={(id) => setValue(field, id, { shouldDirty: true, shouldValidate: !!errors[field] })}
        disabled={!catalog}
        placeholder={catalog ? 'Choose…' : 'Loading…'}
        invalid={!!errors[field]}
        describedBy={errors[field] ? `synonym-${field}-error` : undefined}
      />
      {errors[field] && <p id={`synonym-${field}-error`} className={errorCls}>{errors[field]?.message}</p>}
    </div>
  );

  return (
    <FormDialog
      open
      onClose={onClose}
      title={synonym ? `Edit "${synonym.term}"` : 'Add a synonym'}
      description="Search reads the term as what it points at, in every language. Changes reach the app within a few seconds."
      size="lg"
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel={synonym ? 'Save' : 'Add synonym'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="synonym-term" className={labelCls}>Term</label>
          <input
            id="synonym-term"
            className={inputCls}
            autoComplete="off"
            placeholder="e.g. TRE, बायाँ, ડાબું"
            aria-describedby={errors.term ? 'synonym-term-error' : 'synonym-term-help'}
            {...register('term')}
          />
          {errors.term
            ? <p id="synonym-term-error" className={errorCls}>{errors.term.message}</p>
            : <p id="synonym-term-help" className="mt-1 text-[12.5px] text-gray-500">What buyers type: up to 4 words, any script.</p>}
        </div>

        <fieldset>
          <legend className={labelCls}>Points at</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SYNONYM_TARGETS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm text-gray-900">
                <input type="radio" value={k} className={RADIO_CLS} {...register('targetKind')} />
                {TARGET_KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>

        {catalogError && (kind === 'category' || kind === 'brand' || kind === 'model') && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
            {catalogError}
            <Button variant="secondary" size="sm" onClick={() => void loadCatalog()}>Try again</Button>
          </div>
        )}

        {kind === 'category' && picker('categoryId', 'Target category', choices.category)}
        {kind === 'brand' && picker('brandId', 'Target brand', choices.brand)}
        {kind === 'model' && picker('modelId', 'Target model', choices.model)}

        {kind === 'side' && (
          <fieldset aria-describedby={errors.side ? 'synonym-side-error' : undefined}>
            <legend className={labelCls}>Target side</legend>
            <div className="flex flex-wrap gap-5">
              {SIDES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="radio" value={s} className={RADIO_CLS} {...register('side')} />
                  {SEARCH_SIDE_LABELS[s]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12.5px] text-gray-500">The term becomes a side chip; under Left, Pair listings show after the Left ones.</p>
            {errors.side && <p id="synonym-side-error" className={errorCls}>{errors.side.message}</p>}
          </fieldset>
        )}

        {kind === 'word' && (
          <div>
            <label htmlFor="synonym-word" className={labelCls}>Search for these words too</label>
            <input
              id="synonym-word"
              className={inputCls}
              autoComplete="off"
              placeholder="e.g. tie rod end"
              aria-describedby={errors.word ? 'synonym-word-error' : 'synonym-word-help'}
              {...register('word')}
            />
            {errors.word
              ? <p id="synonym-word-error" className={errorCls}>{errors.word.message}</p>
              : (
                <p id="synonym-word-help" className="mt-1 text-[12.5px] text-gray-500">
                  Search finds listings with the term or with all of these words, so &ldquo;fender&rdquo; also finds mudguards.
                </p>
              )}
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-900">
          <input type="checkbox" className={`${checkCls} mt-0.5`} {...register('isActive')} />
          <span>
            Active
            <span className="block text-[12.5px] text-gray-500">Off: search ignores the term until you turn it back on.</span>
          </span>
        </label>
      </div>
    </FormDialog>
  );
}
