'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  LISTING_FITMENTS_MAX, PART_SIDES, type AdminListingDetail, type AdminListingPatch, type BrandWithModels,
  type CategoryNode, type PartSide,
} from '@mpm/shared-types';
import { SearchableSelect } from '@/components/catalog/searchable-select';
import { Button } from '@/components/ui/button';
import { inputCls, labelCls } from '@/components/ui/field-classes';
import { FormDialog } from '@/components/ui/form-dialog';
import { Skeleton } from '@/components/ui/states';
import { fetchAdminBrands, fetchAdminTree } from '@/lib/catalog-api';
import { findNode, nodesAtLevel } from '@/lib/category-tree';
import { SIDE_LABELS } from '@/lib/listings-api';

type FitPatch = NonNullable<AdminListingPatch['fitments']>[number];

/** One editable fit row: `model` is a model id, `''` (all models of the brand) or `'other'` (typed text). */
interface FitRow {
  key: number;
  brandId: string;
  model: string;
  modelOther: string;
  yearFrom: string;
  yearTo: string;
  note: string;
}

const YEAR_MIN = 1950;
const yearMax = () => new Date().getFullYear() + 1;

function toRows(detail: AdminListingDetail): FitRow[] {
  return detail.listing.fitments.map((f, i) => ({
    key: i,
    brandId: f.brandId,
    model: f.modelId ?? (f.modelOther ? 'other' : ''),
    modelOther: f.modelOther ?? '',
    yearFrom: f.yearFrom == null ? '' : String(f.yearFrom),
    yearTo: f.yearTo == null ? '' : String(f.yearTo),
    note: f.note ?? '',
  }));
}

function toPatch(rows: FitRow[]): FitPatch[] {
  return rows.map((r) => ({
    brandId: r.brandId,
    modelId: r.model && r.model !== 'other' ? r.model : null,
    modelOther: r.model === 'other' ? r.modelOther.trim() || null : null,
    yearFrom: r.yearFrom ? Number(r.yearFrom) : null,
    yearTo: r.yearTo ? Number(r.yearTo) : null,
    note: r.note.trim() || null,
  }));
}

/** The first problem of the fit rows, or null (§4.3: brand required, Other ≤ 60, years 1950 … next year, note ≤ 80). */
export function fitProblem(rows: FitRow[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = `Row ${i + 1}`;
    if (!r.brandId) return `${n}: pick a machine brand`;
    if (r.model === 'other' && !r.modelOther.trim()) return `${n}: type the model, or pick one`;
    if (r.modelOther.trim().length > 60) return `${n}: the model is at most 60 characters`;
    for (const y of [r.yearFrom, r.yearTo]) {
      if (y && (!/^\d{4}$/.test(y) || Number(y) < YEAR_MIN || Number(y) > yearMax())) return `${n}: years run from ${YEAR_MIN} to ${yearMax()}`;
    }
    if (r.yearFrom && r.yearTo && Number(r.yearFrom) > Number(r.yearTo)) return `${n}: "from" comes before "to"`;
    if (r.note.trim().length > 80) return `${n}: the note is at most 80 characters`;
  }
  return null;
}

/**
 * Edit category, side or fit (F2 spec §11.3): what a moderator may correct on a listing. Sends only what changed; the
 * page adds the version. A new category must accept the listing's specs (`400 SPECS_INVALID`, R33); edited fit rows
 * are stored with `source = 'admin'`. Side and fit are for parts only. Mount only while open.
 */
export function ListingEditDialog({ detail, onClose, onSubmit }: {
  detail: AdminListingDetail;
  onClose: () => void;
  /** Resolves true when the dialog should close. */
  onSubmit: (patch: Omit<AdminListingPatch, 'version'>) => Promise<boolean>;
}) {
  const l = detail.listing;
  const isPart = l.kind === 'part';
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [brands, setBrands] = useState<BrandWithModels[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(l.categoryId ?? '');
  const [side, setSide] = useState<PartSide>(l.side ?? 'not_applicable');
  const startRows = useMemo(() => toRows(detail), [detail]);
  const [rows, setRows] = useState<FitRow[]>(startRows);
  const [nextKey, setNextKey] = useState(startRows.length);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchAdminTree(), isPart ? fetchAdminBrands() : Promise.resolve([])])
      .then(([t, b]) => { if (live) { setTree(t); setBrands(b); } })
      .catch((err) => { if (live) setLoadError(err instanceof Error ? err.message : 'Could not load the catalogue'); });
    return () => { live = false; };
  }, [isPart]);

  const choices = useMemo(() => (tree ? nodesAtLevel(tree, isPart ? 'part_group' : 'machine_type') : []), [tree, isPart]);
  const node = tree && categoryId ? findNode(tree, categoryId) : null;
  const nodeHasSides = node?.effectiveHasSides ?? true;
  const machineBrands = (brands ?? []).filter((b) => b.makesMachines || rows.some((r) => r.brandId === b.id));

  const fitsBefore = JSON.stringify(toPatch(startRows));
  const fitsNow = JSON.stringify(toPatch(rows));
  const patch: Omit<AdminListingPatch, 'version'> = {};
  if (categoryId && categoryId !== (l.categoryId ?? '')) patch.categoryId = categoryId;
  if (isPart && side !== (l.side ?? 'not_applicable')) patch.side = side;
  if (isPart && fitsNow !== fitsBefore) patch.fitments = toPatch(rows);
  const changed = Object.keys(patch).length > 0;

  const update = (key: number, change: Partial<FitRow>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <FormDialog
      open
      size="lg"
      onClose={onClose}
      title="Edit category, side or fit"
      description={<>{l.title}. The seller sees the corrected listing; its status doesn&apos;t change.</>}
      dirty={changed}
      submitLabel="Save"
      submitDisabled={!changed || !tree}
      onSubmit={async () => {
        const p = isPart ? fitProblem(rows) : null;
        setProblem(p);
        if (p) return;
        if (await onSubmit(patch)) onClose();
      }}
    >
      {loadError ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{loadError}</p>
      ) : !tree ? (
        <div className="space-y-3" role="status" aria-label="Loading"><Skeleton className="h-10" /><Skeleton className="h-24" /></div>
      ) : (
        <div className="space-y-5">
          <SearchableSelect
            id="edit-category"
            label={isPart ? 'Part group' : 'Machine type'}
            choices={choices}
            value={categoryId}
            onChange={setCategoryId}
          />
          <p className="-mt-3 text-[12.5px] text-gray-500">A new category keeps the listing&apos;s specifications only when they fit its fields.</p>

          {isPart && (
            <div>
              <label htmlFor="edit-side" className={labelCls}>Side</label>
              <select id="edit-side" className={inputCls} value={side} onChange={(e) => setSide(e.target.value as PartSide)}>
                {PART_SIDES.map((s) => <option key={s} value={s}>{SIDE_LABELS[s]}</option>)}
              </select>
              {!nodeHasSides && side !== 'not_applicable' && (
                <p className="mt-1 text-[12.5px] font-semibold text-amber-800">This category has no sides: choose &quot;No side&quot;.</p>
              )}
            </div>
          )}

          {isPart && (
            <fieldset>
              <legend className={labelCls}>Fits</legend>
              {rows.length === 0 && <p className="mb-2 text-sm text-gray-500">No machines listed.</p>}
              <ul className="space-y-3">
                {rows.map((r, i) => {
                  const brand = brands?.find((b) => b.id === r.brandId);
                  return (
                    <li key={r.key} className="rounded-2xl border border-gray-200 p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`fit-brand-${r.key}`} className={labelCls}>Brand</label>
                          <select
                            id={`fit-brand-${r.key}`}
                            className={inputCls}
                            value={r.brandId}
                            onChange={(e) => update(r.key, { brandId: e.target.value, model: '', modelOther: '' })}
                          >
                            <option value="">Choose…</option>
                            {machineBrands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (inactive)'}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`fit-model-${r.key}`} className={labelCls}>Model</label>
                          <select
                            id={`fit-model-${r.key}`}
                            className={inputCls}
                            value={r.model}
                            disabled={!r.brandId}
                            onChange={(e) => update(r.key, { model: e.target.value })}
                          >
                            <option value="">All models</option>
                            {(brand?.models ?? []).filter((m) => m.isActive || m.id === r.model).map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                            <option value="other">Other (type it)</option>
                          </select>
                        </div>
                        {r.model === 'other' && (
                          <div className="sm:col-span-2">
                            <label htmlFor={`fit-other-${r.key}`} className={labelCls}>Model, as typed</label>
                            <input id={`fit-other-${r.key}`} className={inputCls} value={r.modelOther} onChange={(e) => update(r.key, { modelOther: e.target.value })} />
                          </div>
                        )}
                        <div>
                          <label htmlFor={`fit-from-${r.key}`} className={labelCls}>Year from</label>
                          <input id={`fit-from-${r.key}`} inputMode="numeric" className={inputCls} value={r.yearFrom} onChange={(e) => update(r.key, { yearFrom: e.target.value.trim() })} />
                        </div>
                        <div>
                          <label htmlFor={`fit-to-${r.key}`} className={labelCls}>Year to</label>
                          <input id={`fit-to-${r.key}`} inputMode="numeric" className={inputCls} value={r.yearTo} onChange={(e) => update(r.key, { yearTo: e.target.value.trim() })} />
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor={`fit-note-${r.key}`} className={labelCls}>Note</label>
                          <input id={`fit-note-${r.key}`} className={inputCls} value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} />
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                          <Trash2 size={13} aria-hidden /> Remove row {i + 1}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={rows.length >= LISTING_FITMENTS_MAX}
                onClick={() => {
                  setRows((list) => [...list, { key: nextKey, brandId: '', model: '', modelOther: '', yearFrom: '', yearTo: '', note: '' }]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus size={13} aria-hidden /> Add a machine
              </Button>
            </fieldset>
          )}

          {problem && <p role="alert" className="text-sm font-semibold text-red-600">{problem}</p>}
        </div>
      )}
    </FormDialog>
  );
}
