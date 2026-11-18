'use client';

import { useCallback, useState } from 'react';
import {
  LISTING_FLAGS, LISTING_KINDS, LISTING_STATUSES, PART_SIDES, type AdminListingFilters, type CategoryNode,
} from '@mpm/shared-types';
import { ChipGroup, FilterDialog, Section, Segmented, toggleIn, useDraftCount } from '@/components/filter-kit';
import { inputCls } from '@/components/ui/field-classes';
import { FLAG_LABELS, KIND_LABELS, SIDE_LABELS, fetchAdminListings } from '@/lib/listings-api';
import { LISTING_STATUS_LABELS } from '@/lib/status';
import { cn } from '@/lib/utils';

/** What the filter popup edits: every filter but search, seller and paging, as the URL holds them. */
export interface ListingFilterDraft {
  status: string[];
  kind: string;
  machineCategoryId: string;
  city: string;
  side: string;
  flags: string[];
  reported: boolean;
}

export const NO_LISTING_FILTERS: ListingFilterDraft = {
  status: [], kind: '', machineCategoryId: '', city: '', side: '', flags: [], reported: false,
};

/** The draft as API filters (search and seller come from the page). */
export function draftToFilters(d: ListingFilterDraft): AdminListingFilters {
  const f: AdminListingFilters = {};
  if (d.status.length) f.status = d.status as AdminListingFilters['status'];
  if (d.kind) f.kind = d.kind as AdminListingFilters['kind'];
  if (d.machineCategoryId) f.machineCategoryId = d.machineCategoryId;
  if (d.city.trim()) f.city = d.city.trim();
  if (d.side) f.side = d.side as AdminListingFilters['side'];
  if (d.flags.length) f.flags = d.flags as AdminListingFilters['flags'];
  if (d.reported) f.reported = true;
  return f;
}

export const countSelected = (d: ListingFilterDraft) =>
  [d.status.length > 0, d.kind, d.machineCategoryId, d.city.trim(), d.side, d.flags.length > 0, d.reported].filter(Boolean).length;

/**
 * The all-listings filter popup (F2 spec §11.4): status (several), kind, machine category, city, side, flags, has open
 * reports. Nothing reaches the table until Apply; the button counts what the draft would show.
 */
export function ListingFilterDialog({ start, base, categories, onClose, onApply }: {
  start: ListingFilterDraft;
  /** Search and seller, kept while filtering. */
  base: AdminListingFilters;
  /** Machine categories (root nodes); empty while loading. */
  categories: CategoryNode[];
  onClose: () => void;
  onApply: (draft: ListingFilterDraft) => void;
}) {
  const [draft, setDraft] = useState<ListingFilterDraft>(start);
  const countMatches = useCallback(
    async (d: ListingFilterDraft) => (await fetchAdminListings({ ...base, ...draftToFilters(d), page: 1, pageSize: 25 })).total,
    [base],
  );
  const matches = useDraftCount(draft, countMatches);

  return (
    <FilterDialog
      title="Filter listings"
      wide
      selected={countSelected(draft)}
      matches={matches}
      itemLabel={['listing', 'listings']}
      onClear={() => setDraft(NO_LISTING_FILTERS)}
      onClose={onClose}
      onApply={() => onApply(draft)}
    >
      <Section title="Status">
        <ChipGroup
          small
          items={LISTING_STATUSES.map((s) => [s, LISTING_STATUS_LABELS[s]] as [string, string])}
          selected={draft.status}
          onToggle={(v) => setDraft({ ...draft, status: toggleIn(draft.status, v) })}
        />
        <p className="mt-1.5 text-[12.5px] text-gray-500">None picked: every status but drafts.</p>
      </Section>
      <Section title="Kind">
        <Segmented
          items={[['', 'Any'], ...LISTING_KINDS.map((k) => [k, KIND_LABELS[k]] as [string, string])]}
          value={draft.kind}
          onChange={(v) => setDraft({ ...draft, kind: v })}
        />
      </Section>
      <Section title={<label htmlFor="filter-machine-category">Machine category</label>}>
        <select
          id="filter-machine-category"
          className={inputCls}
          value={draft.machineCategoryId}
          onChange={(e) => setDraft({ ...draft, machineCategoryId: e.target.value })}
        >
          <option value="">Any</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Section>
      <Section title={<label htmlFor="filter-city">City</label>}>
        <input
          id="filter-city"
          className={inputCls}
          placeholder="e.g. Surat"
          maxLength={80}
          value={draft.city}
          onChange={(e) => setDraft({ ...draft, city: e.target.value })}
        />
      </Section>
      <Section title="Side">
        <Segmented
          items={[['', 'Any'], ...PART_SIDES.map((s) => [s, SIDE_LABELS[s]] as [string, string])]}
          value={draft.side}
          onChange={(v) => setDraft({ ...draft, side: v })}
        />
      </Section>
      <Section title="Flags">
        <ChipGroup
          small
          items={LISTING_FLAGS.map((f) => [f, FLAG_LABELS[f]] as [string, string])}
          selected={draft.flags}
          onToggle={(v) => setDraft({ ...draft, flags: toggleIn(draft.flags, v) })}
        />
      </Section>
      <Section title="Reports">
        <button
          type="button"
          aria-pressed={draft.reported}
          onClick={() => setDraft({ ...draft, reported: !draft.reported })}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-bold',
            draft.reported ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
          )}
        >
          {draft.reported && '✓ '}Has open reports
        </button>
      </Section>
    </FilterDialog>
  );
}
