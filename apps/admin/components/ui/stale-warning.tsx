'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from './button';

/**
 * A reload failed while the record is already on screen: keep the record and
 * say it may be stale. The full-page ErrorState is only for a first load.
 */
export function StaleWarning({ thing, onRetry }: { thing: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <AlertTriangle size={16} className="shrink-0 text-amber-600" />
      <span className="flex-1">Couldn&apos;t refresh this {thing}. What you see may be out of date.</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}
