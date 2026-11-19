'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { QueryReading } from '@mpm/shared-types';
import { inputCls } from '@/components/ui/field-classes';
import { READ_LEVEL_LABELS, SEARCH_SIDE_LABELS, explainSearchError, previewSearch } from '@/lib/search-api';
import { cn } from '@/lib/utils';

const PREVIEW_DEBOUNCE_MS = 300;

function Chip({ label, children, tone = 'brand' }: { label: string; children: ReactNode; tone?: 'brand' | 'grey' }) {
  return (
    <li
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px]',
        tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-700',
      )}
    >
      <span className="font-bold">{label}</span> {children}
    </li>
  );
}

/** The reading as chips, in the reader's order (§5.3): ref, names, part numbers, side, then the words. */
function ReadingChips({ reading }: { reading: QueryReading }) {
  const chips: ReactNode[] = [];
  if (reading.ref !== null) chips.push(<Chip key="ref" label="Listing">{`#${reading.ref}`}</Chip>);
  if (reading.brand) chips.push(<Chip key="brand" label="Brand">{reading.brand.name}</Chip>);
  if (reading.model) chips.push(<Chip key="model" label="Model">{reading.model.name}</Chip>);
  if (reading.category) chips.push(<Chip key="category" label={READ_LEVEL_LABELS[reading.category.level]}>{reading.category.name}</Chip>);
  reading.partNumbers.forEach((pn) => chips.push(
    <Chip key={`pn-${pn}`} label="Part number"><span className="font-mono">{pn}</span></Chip>,
  ));
  if (reading.side) chips.push(<Chip key="side" label="Side">{SEARCH_SIDE_LABELS[reading.side]}</Chip>);
  reading.words.forEach((w, i) => chips.push(<Chip key={`w-${i}`} label="Word" tone="grey">{w}</Chip>));
  reading.wordGroups.forEach((g, i) => chips.push(
    <Chip key={`g-${i}`} label="Words" tone="grey">{[g.typed, ...g.alternatives].map((ws) => ws.join(' ')).join(' or ')}</Chip>,
  ));

  if (chips.length === 0) return <p className="text-sm text-gray-500">Nothing to search for: only stop words.</p>;
  return <ul className="flex flex-wrap gap-2" aria-label="What search reads">{chips}</ul>;
}

/**
 * "Try a search" (F4 + F5 spec §9): what the query reader makes of a search right now, live as you type. Chips (violet)
 * become filters in the app; words (grey) are matched in the listing text, a word synonym's alternatives with "or".
 */
export function TrySearch({ refreshKey = 0 }: {
  /** Changes after a synonym is saved, so the reading is fetched again. */
  refreshKey?: number;
}) {
  const [q, setQ] = useState('');
  const [reading, setReading] = useState<QueryReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    const mine = ++seq.current;
    if (!text) {
      setReading(null);
      setError(null);
      setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await previewSearch(text);
        if (mine !== seq.current) return;
        setReading(next);
        setError(null);
      } catch (err) {
        if (mine !== seq.current) return;
        setReading(null);
        setError(explainSearchError(err, 'Could not read the search'));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, refreshKey]);

  return (
    <section aria-labelledby="try-search-title" className="mb-6 rounded-[20px] border border-gray-200 bg-white p-4">
      <h2 id="try-search-title" className="text-[15px] font-bold text-gray-900">Try a search</h2>
      <p className="mt-0.5 text-sm text-gray-500">
        Type what a buyer would. Violet chips become filters in the app; grey words are matched in the listing text.
      </p>
      <div className="relative mt-3">
        <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          aria-label="Try a search"
          maxLength={200}
          placeholder="e.g. jcb 3dx gear lh"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={cn(inputCls, 'h-10 pl-9')}
        />
        {loading && <Loader2 size={14} aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
      </div>
      <div className="mt-3 min-h-[28px]" aria-live="polite">
        {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : reading && <ReadingChips reading={reading} />}
      </div>
    </section>
  );
}
