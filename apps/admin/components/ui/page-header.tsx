'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useSetPageTrail } from '@/components/layout/page-trail';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Extra breadcrumb parts after the menu item, e.g. a washer's name. */
  trail?: string[];
}

export function PageHeader({ title, description, actions, back, trail }: PageHeaderProps) {
  useSetPageTrail(trail);
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} data-back-link className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft size={14} /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-gray-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
