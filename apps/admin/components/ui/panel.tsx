import type { ReactNode } from 'react';

/**
 * A titled white card on a record page (business detail, GST review): a heading, an optional action on the right,
 * then the content. `as` picks the heading level for the page's outline (h2 under the page title, h3 inside a section).
 */
export function Panel({
  title, action, as: Heading = 'h2', children,
}: {
  title: string;
  action?: ReactNode;
  as?: 'h2' | 'h3';
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-[10px] border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Heading className="text-sm font-bold text-gray-900">{title}</Heading>
        {action}
      </div>
      {children}
    </section>
  );
}
