'use client';

import Link from 'next/link';
import type { AdminPartRequestDetail } from '@mpm/shared-types';
import { formatDateTime } from '@/lib/utils';

const yes = <span className="font-bold text-green-600">Yes</span>;
const no = <span className="text-gray-500">No</span>;

/**
 * The sellers told about a requirement (F8 spec §5.3, §7.3, §14): rank and score from targeting, whether the notification
 * was pushed (the seller's daily push cap may have held it to in-app only), when it was opened, and whether the seller
 * replied or marked it Not relevant.
 */
export function TargetsTable({ targets, canOpenBusinesses }: {
  targets: AdminPartRequestDetail['targets'];
  canOpenBusinesses: boolean;
}) {
  if (targets.length === 0) return <p className="text-sm text-gray-500">No seller has been told yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Sellers told" className="min-w-full divide-y divide-gray-100 text-sm">
        <thead>
          <tr>
            {['Rank', 'Seller', 'Score', 'Told', 'Pushed', 'Opened', 'Replied', 'Not relevant'].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {targets.map((t) => (
            <tr key={t.businessId}>
              <td className="px-3 py-2 tnum">{t.rank}</td>
              <td className="px-3 py-2">
                {canOpenBusinesses
                  ? <Link href={`/businesses/${t.businessId}/`} className="font-semibold text-brand-700 hover:underline">{t.name}</Link>
                  : <span className="font-semibold text-gray-900">{t.name}</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[13px]">{t.score}</td>
              <td className="px-3 py-2 tnum">{formatDateTime(t.notifiedAt)}</td>
              <td className="px-3 py-2">{t.pushed ? yes : no}</td>
              <td className="px-3 py-2 tnum">{t.openedAt ? formatDateTime(t.openedAt) : '—'}</td>
              <td className="px-3 py-2">{t.replied ? yes : no}</td>
              <td className="px-3 py-2">{t.notRelevant ? <span className="font-bold text-amber-600">Yes</span> : no}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
