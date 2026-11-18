'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Factory, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import type { CategoryNode } from '@mpm/shared-types';
import { ApiError } from '@/lib/api';
import { reorderSiblings } from '@/lib/catalog-api';
import { LEVEL_LABELS, ancestorsOf, filterTree, siblingsOf } from '@/lib/category-tree';
import { CATEGORY_ICON_COMPONENTS } from '@/lib/category-icons';
import { cn } from '@/lib/utils';

const REORDER_BTN = 'rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40';

interface CategoryTreeProps {
  nodes: CategoryNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Filters by name; while set, every branch with a match is open. */
  query: string;
  /**
   * Reloads the tree after a reorder was saved, or after STALE_ORDER (the list changed
   * elsewhere). Up/down stay disabled until it resolves, so the next move starts from the
   * order the server has.
   */
  onReordered?: () => Promise<void> | void;
  /** false hides the up/down buttons (a page that only picks a node). */
  reorderable?: boolean;
}

/**
 * The machine catalogue as an expandable list: categories → machine types → part groups (A4).
 * Clicking a row selects it and opens it; the chevron only opens or closes.
 * Up/down send the whole sibling list in its new order (the API wants the exact set). The
 * list, its ends and the neighbour come from the unfiltered tree, so a search that hides
 * siblings never sends a partial list.
 */
export function CategoryTree({ nodes, selectedId, onSelect, query, onReordered, reorderable = true }: CategoryTreeProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const filtering = query.trim() !== '';
  const shown = useMemo(() => filterTree(nodes, query), [nodes, query]);
  // Each node's place among its full (unfiltered) siblings: decides the ends whatever the search hides.
  const place = useMemo(() => {
    const map = new Map<string, { first: boolean; last: boolean }>();
    const walk = (list: CategoryNode[]) => list.forEach((n, i) => {
      map.set(n.id, { first: i === 0, last: i === list.length - 1 });
      walk(n.children);
    });
    walk(nodes);
    return map;
  }, [nodes]);

  // A node selected from elsewhere (e.g. a child just added, or a ?node= link) gets its branch opened.
  useEffect(() => {
    if (!selectedId) return;
    const chain = ancestorsOf(nodes, selectedId).slice(0, -1);
    if (!chain.length) return;
    setOpen((prev) => (chain.every((n) => prev.has(n.id)) ? prev : new Set(Array.from(prev).concat(chain.map((n) => n.id)))));
  }, [nodes, selectedId]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = async (node: CategoryNode, delta: -1 | 1) => {
    // Always the full, unfiltered sibling list.
    const siblings = siblingsOf(nodes, node.id);
    const index = siblings.findIndex((s) => s.id === node.id);
    const to = index + delta;
    if (index === -1 || to < 0 || to >= siblings.length) return;
    const ids = siblings.map((s) => s.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    setBusy(true);
    try {
      try {
        await reorderSiblings(node.parentId, ids);
      } catch (err) {
        const stale = err instanceof ApiError && err.code === 'STALE_ORDER';
        toast.error(stale ? 'Someone changed this list; reloaded' : err instanceof Error ? err.message : 'Could not reorder');
        // Only a stale list needs the reload; any other failure left the order as shown.
        if (!stale) return;
      }
      await onReordered?.();
    } finally {
      setBusy(false);
    }
  };

  const renderList = (list: CategoryNode[], depth: number) => (
    <ul
      aria-label={depth === 0 ? 'Categories' : undefined}
      className={cn(depth === 0 ? 'space-y-0.5' : 'mb-1 ml-[17px] mt-0.5 space-y-0.5 border-l border-gray-200 pl-2')}
    >
      {list.map((n) => {
        const expanded = filtering || open.has(n.id);
        const hasChildren = n.children.length > 0;
        const selected = n.id === selectedId;
        const { first, last } = place.get(n.id) ?? { first: true, last: true };
        const sided = n.level === 'part_group' && n.effectiveHasSides;
        return (
          <li key={n.id}>
            <div
              data-tree-row
              title={LEVEL_LABELS[n.level]}
              className={cn(
                'group relative flex items-center gap-1 rounded-lg pl-1 pr-1 transition-colors',
                selected ? 'bg-brand-50 shadow-[inset_3px_0_0_theme(colors.brand.600)]' : 'hover:bg-gray-50',
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                onClick={() => toggle(n.id)}
                disabled={!hasChildren || filtering}
                className={cn('rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900', !hasChildren && 'invisible')}
              >
                <ChevronRight size={15} className={cn('transition-transform', expanded && 'rotate-90')} />
              </button>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                aria-expanded={hasChildren ? expanded : undefined}
                onClick={() => {
                  onSelect(n.id);
                  if (hasChildren && !open.has(n.id)) toggle(n.id);
                }}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                  n.level === 'part_group' ? 'py-1' : 'py-1.5',
                )}
              >
                <LevelMark node={n} selected={selected} />
                <span
                  className={cn(
                    'truncate',
                    n.level === 'machine_category' && 'text-sm font-bold text-gray-900',
                    n.level === 'machine_type' && 'text-sm font-semibold text-gray-600',
                    n.level === 'part_group' && 'text-[13.5px] font-semibold text-gray-600',
                    selected && 'font-extrabold text-brand-700',
                    !n.isActive && 'text-gray-500 line-through decoration-gray-300',
                  )}
                >
                  <Highlight text={n.name} query={query} />
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {sided && (
                    <span
                      title="Parts here have a left and a right side"
                      className="inline-flex h-5 items-center rounded-full bg-amber-50 px-[7px] font-mono text-[11px] font-bold text-amber-700"
                    >
                      L | R
                    </span>
                  )}
                  {hasChildren && (
                    <span
                      className={cn(
                        'rounded-full px-[7px] text-xs font-bold tnum',
                        selected ? 'bg-white text-brand-700' : 'bg-gray-100 text-gray-500',
                      )}
                    >
                      {n.children.length}
                    </span>
                  )}
                  {!n.isActive && (
                    <span className="inline-flex h-6 items-center rounded-full bg-gray-100 px-[9px] text-[13px] font-semibold text-gray-500">
                      Off
                    </span>
                  )}
                </span>
              </button>
              {reorderable && (
                <span
                  className={cn(
                    'flex shrink-0 transition-opacity',
                    selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Move ${n.name} up`}
                    disabled={busy || first}
                    onClick={() => void move(n, -1)}
                    className={cn(REORDER_BTN, first && 'invisible')}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${n.name} down`}
                    disabled={busy || last}
                    onClick={() => void move(n, 1)}
                    className={cn(REORDER_BTN, last && 'invisible')}
                  >
                    <ArrowDown size={13} />
                  </button>
                </span>
              )}
            </div>
            {hasChildren && expanded && renderList(n.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  if (filtering && shown.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-base font-bold text-gray-900">No matches</p>
        <p className="mt-1 text-sm text-gray-500">Nothing is called “{query.trim()}”.</p>
      </div>
    );
  }
  return renderList(shown, 0);
}

/** Categories get their icon in a tinted tile; machine types a machine; part groups a dot. */
function LevelMark({ node, selected }: { node: CategoryNode; selected: boolean }) {
  if (node.level === 'machine_category') {
    const Icon = (node.icon && CATEGORY_ICON_COMPONENTS[node.icon]) || LayoutGrid;
    return (
      <span
        aria-hidden
        className={cn(
          'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]',
          !node.isActive ? 'bg-gray-100 text-gray-500' : selected ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700',
        )}
      >
        <Icon size={15} />
      </span>
    );
  }
  if (node.level === 'machine_type') {
    return <Factory aria-hidden size={14} className={cn('shrink-0', selected ? 'text-brand-700' : 'text-gray-500')} />;
  }
  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', selected ? 'bg-brand-600' : 'bg-gray-300')} />;
}

/** The name with the search match marked. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-amber-100 px-px text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}
