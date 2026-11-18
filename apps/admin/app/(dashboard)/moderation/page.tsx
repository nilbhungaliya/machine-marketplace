'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { MODERATION_TABS, type AdminModerationQueue, type ModerationCounts, type ModerationTab } from '@mpm/shared-types';
import { ListingReview } from '@/components/listings/listing-review';
import { ModerationQueue } from '@/components/listings/moderation-queue';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { MODERATION_TAB_LABELS, fetchModerationCounts, fetchModerationQueue } from '@/lib/listings-api';
import { useTabParam } from '@/lib/use-tab-param';
import { positiveInt, useUrlState } from '@/lib/use-url-state';

/**
 * A3 Listing moderation (F2 spec §11.1): tabs Review · Reported · Decided, the tab's listings on the left and the
 * selected listing's review screen on the right. Tab, listing and page live in the URL (`?tab=`, `?id=`, `?page=`).
 */
export default function ModerationPage() {
  const [tab, setTab, tabReady] = useTabParam<ModerationTab>(MODERATION_TABS);
  const [{ id: selectedId, page }, setUrl, urlReady] = useUrlState({ id: '', page: '1' }, { validate: { page: positiveInt } });
  const ready = tabReady && urlReady;
  // Tagged with the tab and page they came from, so a tab switch never shows (or auto-opens) another tab's rows.
  const [listed, setListed] = useState<{ key: string; queue: AdminModerationQueue } | null>(null);
  const key = `${tab}:${page}`;
  const queue = listed?.key === key ? listed.queue : null;
  const [counts, setCounts] = useState<ModerationCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    fetchModerationCounts().then(setCounts).catch(() => {});
    try {
      const next = await fetchModerationQueue(tab, Number(page));
      if (ticket !== latest.current) return;
      setListed({ key: `${tab}:${page}`, queue: next });
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the queue');
    }
  }, [tab, page]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  // Nothing picked: open the first listing, as the queue reads top-down.
  useEffect(() => {
    if (ready && queue && queue.rows.length > 0 && !selectedId) setUrl({ id: queue.rows[0].id });
  }, [ready, queue, selectedId, setUrl]);

  const switchTab = (next: ModerationTab) => {
    if (next === tab) return;
    setListed(null);
    setUrl({ id: '', page: '1' });
    setTab(next);
  };

  const countFor = (t: ModerationTab) => (t === 'decided' ? undefined : counts?.[t]);
  const tabs = MODERATION_TABS.map((value) => ({ value, label: MODERATION_TAB_LABELS[value], count: countFor(value) }));
  const here = `/moderation/?${tab === 'review' ? '' : `tab=${tab}&`}id=${selectedId}`;

  return (
    <div>
      <PageHeader
        title="Listing moderation"
        description="Listings waiting for review and listings buyers reported. Check the photos, specs, side and fit, then approve, ask for changes or reject."
      />
      <Tabs items={tabs} value={tab} onChange={switchTab} />

      {error && !queue ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          {error && <StaleWarning thing="list" onRetry={() => void load()} />}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <ModerationQueue
              tab={tab}
              queue={ready ? queue : null}
              selectedId={selectedId || null}
              onSelect={(id) => setUrl({ id })}
              onPage={(p) => { setUrl({ page: String(p), id: '' }); }}
            />
            <section aria-label="Selected listing">
              {ready && selectedId ? (
                <ListingReview
                  key={selectedId}
                  id={selectedId}
                  onChanged={() => void load()}
                  from={{ href: here, label: 'Listing moderation' }}
                />
              ) : queue && queue.rows.length > 0 ? (
                <div className="rounded-[20px] border border-gray-200 bg-white">
                  <EmptyState title="Pick a listing" description="Its photos, specs, seller and history open here." />
                </div>
              ) : (
                <div className="hidden rounded-[20px] border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 lg:block">
                  <MousePointerClick size={18} aria-hidden className="mx-auto mb-2 text-gray-400" />
                  Listings open here.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
