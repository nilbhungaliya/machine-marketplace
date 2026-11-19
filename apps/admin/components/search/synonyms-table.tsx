'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SYNONYM_TARGETS, type SearchSynonym, type SynonymTarget } from '@mpm/shared-types';
import { ActiveSwitch, Tag } from '@/components/catalog/active-switch';
import { useConfirm } from '@/components/confirm-provider';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { inputCls } from '@/components/ui/field-classes';
import {
  SCRIPT_LABELS, SEARCH_SIDE_LABELS, TARGET_KIND_LABELS, deleteSynonym, explainSearchError, isApiCode, updateSynonym,
} from '@/lib/search-api';
import { cn, formatDate } from '@/lib/utils';

const SEARCH_DEBOUNCE_MS = 300;

export interface SynonymsTableProps {
  rows: SearchSynonym[];
  /** The search box's committed value (from the URL). */
  q: string;
  onQChange: (q: string) => void;
  /** '' = every kind. */
  kind: SynonymTarget | '';
  onKindChange: (kind: SynonymTarget | '') => void;
  hasMore: boolean;
  loadingMore: boolean;
  /** A reload for new filters is in flight: the rows shown are the old filters' (dimmed, no Load more). */
  reloading?: boolean;
  onLoadMore: () => void;
  onEdit: (row: SearchSynonym) => void;
  /** Reloads the list after a change made here (on / off, delete). */
  onChanged: () => Promise<void> | void;
}

/** What a synonym points at: the category path, brand or model name, the side, or the words. */
function TargetCell({ row }: { row: SearchSynonym }) {
  let text: string;
  if (row.targetKind === 'side') text = row.targetSide ? SEARCH_SIDE_LABELS[row.targetSide] : '—';
  else if (row.targetKind === 'word') text = row.targetWord ?? '—';
  else text = row.targetName ?? 'Removed from the catalogue';
  return (
    <span className="inline-flex items-center gap-2">
      <Tag tone={row.targetKind === 'word' ? 'grey' : 'brand'}>{TARGET_KIND_LABELS[row.targetKind]}</Tag>
      <span className={cn('text-gray-900', row.targetKind !== 'word' && !row.targetName && row.targetKind !== 'side' && 'text-gray-500')}>
        {text}
      </span>
    </span>
  );
}

/**
 * The search synonyms (F4 + F5 spec §4.2, §9): term, script, target, on / off, last change; a search box and a target
 * kind filter (both server side), Edit, Delete with a confirm, and Load more (cursor pages of 50).
 */
export function SynonymsTable({
  rows, q, onQChange, kind, onKindChange, hasMore, loadingMore, reloading = false, onLoadMore, onEdit, onChanged,
}: SynonymsTableProps) {
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [text, setText] = useState(q);

  // The box follows the URL (back / forward), and commits after a pause in typing. It follows only when the URL really
  // differs: the URL holds the trimmed text, so copying it back would eat a trailing space mid-typing ("tie " + "rod").
  const committed = useRef(q);
  useEffect(() => {
    committed.current = q;
    setText((prev) => (prev.trim() === q ? prev : q));
  }, [q]);
  useEffect(() => {
    if (text.trim() === committed.current.trim()) return;
    const t = setTimeout(() => {
      committed.current = text;
      onQChange(text.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, onQChange]);

  const run = async (row: SearchSynonym, work: () => Promise<unknown>, success: string) => {
    setBusyId(row.id);
    try {
      await work();
      toast.success(success);
      await onChanged();
    } catch (err) {
      toast.error(explainSearchError(err, 'Could not save'));
      if (isApiCode(err, 'NOT_FOUND')) await onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: SearchSynonym) => {
    const ok = await confirm({
      title: `Delete "${row.term}"?`,
      message: 'Search stops reading this term within a few seconds. To pause it instead, turn it off.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) await run(row, () => deleteSynonym(row.id), 'Synonym deleted');
  };

  const columns: Column<SearchSynonym>[] = [
    {
      key: 'term',
      header: 'Term',
      render: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className={cn('font-bold text-gray-900', !r.isActive && 'text-gray-500')}>{r.term}</span>
          {r.termNorm !== r.term && <code className="font-mono text-xs text-gray-500" title="As search reads it">{r.termNorm}</code>}
        </span>
      ),
    },
    { key: 'script', header: 'Script', render: (r) => SCRIPT_LABELS[r.script] },
    { key: 'target', header: 'Points at', render: (r) => <TargetCell row={r} /> },
    {
      key: 'isActive',
      header: 'Active',
      render: (r) => (
        <ActiveSwitch
          checked={r.isActive}
          label={`${r.term} active`}
          disabled={busyId !== null}
          onToggle={() => void run(r, () => updateSynonym(r.id, { isActive: !r.isActive }), r.isActive ? 'Synonym turned off' : 'Synonym turned on')}
        />
      ),
    },
    { key: 'updatedAt', header: 'Updated', className: 'tnum', render: (r) => formatDate(r.updatedAt) },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label={`Edit ${r.term}`} onClick={() => onEdit(r)}>
            <Pencil size={13} aria-hidden /> Edit
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Delete ${r.term}`} disabled={busyId !== null} onClick={() => void remove(r)}>
            <Trash2 size={13} aria-hidden /> Delete
          </Button>
        </span>
      ),
    },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[14rem] flex-1">
        <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          aria-label="Search synonyms"
          maxLength={100}
          placeholder="Search terms and words"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={cn(inputCls, 'h-9 pl-9')}
        />
      </div>
      <label htmlFor="synonym-kind-filter" className="text-sm font-semibold text-gray-700">Target</label>
      <select
        id="synonym-kind-filter"
        value={kind}
        onChange={(e) => onKindChange(e.target.value as SynonymTarget | '')}
        className={cn(inputCls, 'h-9 w-auto min-w-[10rem]')}
      >
        <option value="">Every kind</option>
        {SYNONYM_TARGETS.map((k) => <option key={k} value={k}>{TARGET_KIND_LABELS[k]}</option>)}
      </select>
    </div>
  );

  return (
    <>
      {/* Only the rows dim while new filters load: the search box above them stays usable. */}
      <div aria-busy={reloading}>
        <DataTable
          columns={columns}
          data={rows}
          toolbar={toolbar}
          rowClassName={(r) => cn(!r.isActive && 'bg-gray-50', reloading && 'opacity-60')}
          emptyMessage={q || kind ? 'No synonyms match' : 'No synonyms yet'}
        />
      </div>
      {hasMore && !reloading && (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={onLoadMore}>Load more</Button>
        </div>
      )}
    </>
  );
}
