'use client';

import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Stand-in for a module that hasn't been built yet. Replace the page that renders
 * it with the real screen; `scope` lists what the product scope expects there.
 */
export default function ModulePlaceholder({ title, description, scope }: {
  title: string;
  description: string;
  scope: string[];
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Construction size={16} className="text-brand-600" aria-hidden />
          Not built yet — planned screens and actions
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
          {scope.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </div>
    </>
  );
}
