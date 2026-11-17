'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  className?: string;
  /** Makes the card a toggle button; `active` draws the selected ring. */
  onClick?: () => void;
  active?: boolean;
  /**
   * Makes the whole card a link. Only for a page that lists exactly the counted
   * records; a general page goes in `link` instead.
   */
  href?: string;
  /** A text link under the card, e.g. "View in Reports". Ignored with `href` or `onClick` (no nested links). */
  link?: { href: string; label: string };
}

export default function StatCard({
  title, value, subtitle, icon, className, onClick, active, href, link,
}: StatCardProps) {
  const classes = cn(
    'rounded-xl bg-white p-5 shadow-sm border border-gray-200/70 transition-shadow hover:shadow-md',
    onClick && 'w-full text-left',
    href && 'block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
    active && 'ring-2 ring-brand-500 ring-offset-1',
    className,
  );
  const body = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        {subtitle && (
          <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
        )}
        {link && !href && !onClick && (
          <Link href={link.href} className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {icon && (
        <div className="rounded-lg bg-brand-50 p-2.5 text-brand-600 ring-1 ring-brand-100">
          {icon}
        </div>
      )}
    </div>
  );

  if (href) return <Link href={href} className={classes}>{body}</Link>;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': !!active } : {})}
      className={classes}
    >
      {body}
    </Tag>
  );
}
