'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { GST_REVIEW_QUEUES, type AdminGstReviewRow, type GstReviewQueue } from '@mpm/shared-types';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { ReviewDetail } from '@/components/verification/review-detail';
import { ReviewQueue } from '@/components/verification/review-queue';
import { useTabParam } from '@/lib/use-tab-param';
import { useUrlState } from '@/lib/use-url-state';
import { QUEUE_LABELS, REVIEW_LIST_CAP, fetchReviews } from '@/lib/verification-api';

/**
 * A2 Business verification (F1 + A2 spec §8.1): tabs Waiting · Needs more · Decided, the tab's reviews on the left and
 * the selected review on the right. Tab and review live in the URL (`?tab=`, `?review=`).
 */
export default function VerificationPage() {
  const [queue, setQueue, tabReady] = useTabParam<GstReviewQueue>(GST_REVIEW_QUEUES);
  const [{ review: selectedId }, setUrl, urlReady] = useUrlState({ review: '' });
  const ready = tabReady && urlReady;
  // Tagged with the tab they came from: after a tab switch the previous tab's rows must never be read as this tab's
  // (the auto-select below would open a review of the wrong tab).
  const [listed, setListed] = useState<{ queue: GstReviewQueue; rows: AdminGstReviewRow[] } | null>(null);
  const rows = listed?.queue === queue ? listed.rows : null;
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchReviews(queue);
      if (ticket !== latest.current) return;
      setListed({ queue, rows: next });
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the reviews');
    }
  }, [queue]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  // Nothing picked (a fresh tab): open the first review, as the queue reads top-down.
  useEffect(() => {
    if (ready && rows && rows.length > 0 && !selectedId) setUrl({ review: rows[0].id });
  }, [ready, rows, selectedId, setUrl]);

  const switchQueue = (next: GstReviewQueue) => {
    if (next === queue) return;
    setListed(null);
    setUrl({ review: '' });
    setQueue(next);
  };

  const count = rows ? (rows.length >= REVIEW_LIST_CAP ? `${REVIEW_LIST_CAP}+` : rows.length) : undefined;
  const tabs = GST_REVIEW_QUEUES.map((value) => ({ value, label: QUEUE_LABELS[value], count: value === queue ? count : undefined }));

  return (
    <div>
      <PageHeader
        title="Business verification"
        description="GST reviews businesses send with their documents. Check the details against the GST portal, then approve, reject or ask for more."
      />
      <Tabs items={tabs} value={queue} onChange={switchQueue} />

      {error && !rows ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          {error && <StaleWarning thing="list" onRetry={() => void load()} />}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <ReviewQueue queue={queue} rows={ready ? rows : null} selectedId={selectedId || null} onSelect={(id) => setUrl({ review: id })} />
            <section aria-label="Selected review">
              {ready && selectedId ? (
                <ReviewDetail key={selectedId} id={selectedId} onChanged={() => void load()} />
              ) : rows && rows.length > 0 ? (
                <div className="rounded-[20px] border border-gray-200 bg-white">
                  <EmptyState title="Pick a review" description="Its details, documents and history open here." />
                </div>
              ) : (
                <div className="hidden rounded-[20px] border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 lg:block">
                  <MousePointerClick size={18} aria-hidden className="mx-auto mb-2 text-gray-400" />
                  Reviews open here.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
