'use client';

import { useState } from 'react';
import { FolderTree, Search, X } from 'lucide-react';
import type { CategoryNode } from '@mpm/shared-types';
import { CategoryTree } from './category-tree';

/** The left column of the catalogue pages: a search box over the category tree. */
export function TreePanel({ tree, selectedId, onSelect, onReordered, reorderable = true }: {
  tree: CategoryNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReordered?: () => Promise<void> | void;
  reorderable?: boolean;
}) {
  const [query, setQuery] = useState('');
  return (
    <section
      aria-label="Category tree"
      className="flex flex-col overflow-hidden rounded-[10px] border border-gray-200 bg-white lg:sticky lg:top-0 lg:max-h-[calc(100vh-8rem)]"
    >
      <div className="space-y-2 border-b border-gray-200 px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <FolderTree size={16} className="text-brand-800" aria-hidden /> Catalogue
          </h2>
          <span className="text-[13px] text-gray-500 tnum">{tree.length} categories</span>
        </div>
        <div className="relative">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            aria-label="Search categories"
            placeholder="Search categories, machine types, part groups…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-[34px] w-full rounded-lg border-gray-300 bg-gray-50 pl-9 pr-8 text-sm placeholder:text-gray-400 focus:bg-white [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <CategoryTree
          nodes={tree}
          selectedId={selectedId}
          onSelect={onSelect}
          query={query}
          onReordered={onReordered}
          reorderable={reorderable}
        />
      </div>
    </section>
  );
}
