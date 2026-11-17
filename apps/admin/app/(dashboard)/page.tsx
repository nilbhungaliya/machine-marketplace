'use client';

import {
  Building2, CalendarClock, CheckCircle2, Handshake, MessageSquareQuote, Package, Tag, Wrench,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import StatCard from '@/components/stat-card';

// KPI tiles from the scope's admin dashboard (A1). Values are placeholders until GET /admin/dashboard exists.
const KPIS = [
  { title: 'Businesses / users', icon: <Building2 size={18} /> },
  { title: 'Active listings', icon: <Package size={18} /> },
  { title: 'Parts available', icon: <Wrench size={18} /> },
  { title: 'Machinery for rental', icon: <CalendarClock size={18} /> },
  { title: 'New enquiries', icon: <MessageSquareQuote size={18} /> },
  { title: 'Offers', icon: <Tag size={18} /> },
  { title: 'Deals', icon: <Handshake size={18} /> },
  { title: 'Sold / closed listings', icon: <CheckCircle2 size={18} /> },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Marketplace health at a glance" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => <StatCard key={k.title} title={k.title} value="—" icon={k.icon} />)}
      </div>
      <div className="mt-6 rounded-xl border border-gray-200/70 bg-white shadow-sm">
        <EmptyState
          title="No data yet"
          description="Marketplace activity (listings, enquiries, offers, deals, rental bookings) by city and category appears here once the API serves it."
        />
      </div>
    </>
  );
}
