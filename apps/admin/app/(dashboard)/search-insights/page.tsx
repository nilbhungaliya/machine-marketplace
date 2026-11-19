'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { TrendingRow, ZeroResultRow } from '@mpm/shared-types';
import { SynonymDialog } from '@/components/search/synonym-dialog';
import { TrendingTable } from '@/components/search/trending-table';
import { ZeroResultsTable } from '@/components/search/zero-results-table';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { explainSearchError, fetchTrending, fetchZeroResults } from '@/lib/search-api';

/** One list's load state: rows once loaded, the last error (kept with stale rows as a warning). */
function useList<T>(fetcher: () => Promise<T[]>, what: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(await fetcher());
      setError(null);
    } catch (err) {
      setError(explainSearchError(err, `Could not load ${what}`));
    }
  }, [fetcher, what]);
  useEffect(() => { void load(); }, [load]);
  return { rows, error, load };
}

function Section({ id, title, description, error, loaded, onRetry, children }: {
  id: string;
  title: string;
  description: string;
  error: string | null;
  loaded: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="text-[17px] font-bold text-gray-900">{title}</h2>
      <p className="mb-3 mt-0.5 text-sm text-gray-500">{description}</p>
      {error && !loaded ? (
        <ErrorState title={`Couldn't load ${title.toLowerCase()}`} message={error} onRetry={onRetry} />
      ) : !loaded ? (
        <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={5} cols={3} /></div>
      ) : (
        <>
          {error && <StaleWarning thing="list" onRetry={onRetry} />}
          {children}
        </>
      )}
    </section>
  );
}

/**
 * Search insights (F4 + F5 spec §5.12, §5.13, §9; category_manager): what buyers searched for and didn't find (turn it
 * into a synonym), and what is trending (hide what shouldn't show in the app). Searches are stored normalised and
 * without personal data.
 */
export default function SearchInsightsPage() {
  const zero = useList<ZeroResultRow>(fetchZeroResults, 'the searches');
  const trending = useList<TrendingRow>(fetchTrending, 'trending');
  const [makeTerm, setMakeTerm] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Search insights"
        description="What buyers search for in the app: searches that found nothing, and searches that are trending."
      />

      <Section
        id="zero-results-title"
        title="Found nothing"
        description="Top 50 searches of the last 30 days with no results. A synonym often fixes a spelling or another name."
        error={zero.error}
        loaded={zero.rows !== null}
        onRetry={() => void zero.load()}
      >
        <ZeroResultsTable rows={zero.rows ?? []} onMakeSynonym={setMakeTerm} />
      </Section>

      <Section
        id="trending-title"
        title="Trending"
        description="Top 20 searches of the last 7 days. The app shows those searched on 3 or more days, 5 or more times; hidden ones never show."
        error={trending.error}
        loaded={trending.rows !== null}
        onRetry={() => void trending.load()}
      >
        <TrendingTable rows={trending.rows ?? []} onChanged={trending.load} />
      </Section>

      {makeTerm !== null && (
        <SynonymDialog
          initialTerm={makeTerm}
          onClose={() => setMakeTerm(null)}
          onSaved={() => {
            setMakeTerm(null);
            void zero.load();
          }}
        />
      )}
    </div>
  );
}
