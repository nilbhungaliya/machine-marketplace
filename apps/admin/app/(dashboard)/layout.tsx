'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/layout/sidebar';
import TopBar from '@/components/layout/top-bar';
import { ConfirmProvider } from '@/components/confirm-provider';
import { PageTrailProvider } from '@/components/layout/page-trail';
import { SidebarStateProvider, useSidebarState } from '@/components/layout/sidebar-state';
import { KeyboardNav } from '@/components/layout/keyboard-nav';
import { cn } from '@/lib/utils';

// Its own component so it sits below SidebarStateProvider and can read it.
function Shell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarState();
  return (
    // The page is a rounded card on the sidebar's colour, inset on every side.
    <div className="flex h-screen overflow-hidden bg-side">
      <KeyboardNav />
      <Sidebar />
      <div className={cn('flex min-w-0 flex-1 p-2 transition-[padding] duration-200', collapsed ? 'pl-16' : 'pl-60')}>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-gray-50 shadow-sm">
          <TopBar />
          <main id="admin-main" data-nav-main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login');
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <ConfirmProvider>
      <SidebarStateProvider>
        <PageTrailProvider>
          <Shell>{children}</Shell>
        </PageTrailProvider>
      </SidebarStateProvider>
      <Toaster richColors position="top-right" visibleToasts={3} />
    </ConfirmProvider>
  );
}
