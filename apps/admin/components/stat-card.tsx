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
    'rounded-[20px] border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300',
    onClick && 'w-full text-left',
    href && 'block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
    active && 'ring-2 ring-brand-600 ring-offset-1',
    className,
  );
  const body = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-semibold text-gray-400">{title}</p>
        <p className="mt-1 text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-gray-900">{value}</p>
        {subtitle && (
          <p className="mt-1 text-[11.5px] font-bold text-green-600">{subtitle}</p>
        )}
        {link && !href && !onClick && (
          <Link href={link.href} className="mt-2 inline-block text-xs font-bold text-brand-600 hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {icon && (
        <div className="rounded-full bg-brand-50 p-2.5 text-brand-700">
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
