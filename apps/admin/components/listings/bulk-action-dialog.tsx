'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { AdminListingBulkAction, AdminListingBulkResult, AdminListingRow } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { bulkListings, codeWords, explainListingError, formatRef } from '@/lib/listings-api';
import { refreshNavBadges } from '@/lib/nav-badges';

const COPY: Record<AdminListingBulkAction, { verb: string; past: string; description: string }> = {
  hide: {
    verb: 'Hide',
    past: 'Hid',
    description: 'Buyers stop seeing them at once; open reports are closed as actioned. Each can be unhidden later.',
  },
  remove: {
    verb: 'Remove',
    past: 'Removed',
    description: 'This is final. Sellers see each listing for 30 days with your reason.',
  },
};

const plural = (n: number) => `${n} ${n === 1 ? 'listing' : 'listings'}`;

/**
 * Bulk Hide / Remove on the all-listings page (F2 spec §11.3, R34): one reason for every selected listing; the API
 * runs one transaction per listing and reports the ones it skipped with their code, which this dialog then lists.
 * Mount only while open.
 */
export function BulkActionDialog({ action, rows, onClose, onDone }: {
  action: AdminListingBulkAction;
  /** The selected rows (1–ADMIN_LISTING_BULK_MAX). */
  rows: AdminListingRow[];
  onClose: () => void;
  /** After the request: the page clears the selection and reloads. */
  onDone: () => void;
}) {
  const [result, setResult] = useState<AdminListingBulkResult | null>(null);
  const copy = COPY[action];

  if (result) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return (
      <Dialog
        open
        onClose={onClose}
        title={`${copy.past} ${plural(result.done.length)}`}
        description={result.skipped.length ? `${plural(result.skipped.length)} skipped:` : undefined}
        size="md"
        footer={<Button data-dialog-primary onClick={onClose}>Done</Button>}
      >
        {result.skipped.length > 0 ? (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {result.skipped.map((s) => {
              const row = byId.get(s.id);
              return (
                <li key={s.id} className="px-3 py-2 text-sm">
                  <span className="block font-bold text-gray-900">{row?.title ?? s.id}</span>
                  {row && <span className="font-mono text-xs text-gray-500">{formatRef(row.ref)}</span>}
                  <span className="block text-[13px] text-gray-600">{codeWords(s.code)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">Every selected listing was done.</p>
        )}
      </Dialog>
    );
  }

  return (
    <ReasonDialog
      title={`${copy.verb} ${plural(rows.length)}`}
      description={copy.description}
      submitLabel={`${copy.verb} ${rows.length}`}
      submitVariant="danger"
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          const next = await bulkListings({ action, ids: rows.map((r) => r.id), reason });
          refreshNavBadges();
          onDone();
          if (next.skipped.length === 0) {
            toast.success(`${copy.past} ${plural(next.done.length)}`);
            return true;
          }
          setResult(next);
          // Keep this component mounted: the result replaces the form.
          return false;
        } catch (err) {
          toast.error(explainListingError(err, `Could not ${copy.verb.toLowerCase()} the listings`));
          return false;
        }
      }}
    />
  );
}
