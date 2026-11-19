import type { ReactNode } from 'react';

/** Label / value rows on a record page (as the business page's), shared by the F6 + F7 admin records. */
export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-3.5 gap-y-2 text-sm sm:grid-cols-[150px_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="mb-1.5 font-semibold text-gray-900 sm:mb-0">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
