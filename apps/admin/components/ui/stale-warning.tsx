'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from './button';

/**
 * A reload failed while the record is already on screen: keep the record and
 * say it may be stale. The full-page ErrorState is only for a first load.
 * `message` / `retryLabel` reword it for a record that changed under the reader
 * (a listing the seller edited during a review: "Reload").
 */
export function StaleWarning({ thing, onRetry, message, retryLabel = 'Try again' }: {
  thing: string;
  onRetry: () => void;
  message?: string;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border-0 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
      <AlertTriangle size={16} className="shrink-0 text-amber-600" />
      <span className="flex-1">{message ?? <>Couldn&apos;t refresh this {thing}. What you see may be out of date.</>}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}
