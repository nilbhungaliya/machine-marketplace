'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AppSettingsView } from '@mpm/shared-types';
import { MarketplaceSettingsForm } from '@/components/settings/marketplace-settings-form';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { classifyLoadError } from '@/lib/load-error';
import { fetchSettings } from '@/lib/settings-api';

const LOAD_MESSAGES = {
  not_found: 'Settings are not available on this server yet.',
  forbidden: 'Only super admins can change the marketplace settings.',
  failed: 'Check your connection and try again.',
};

/**
 * Settings (F2 spec §11.5, AD7): its first section is Marketplace, the scalar rules of §12 (expiry, reminder, review of
 * first listings, unverified cap). Admin accounts and roles stay a placeholder section. Super admin only (R30).
 */
export default function SettingsPage() {
  const [view, setView] = useState<AppSettingsView | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setView(await fetchSettings());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Marketplace rules and, later, admin accounts and roles." />

      <Panel title="Marketplace">
        <p className="mb-4 text-sm text-gray-600">
          Changes apply at once: the next expiry run and the next listing published use them.
        </p>
        {view ? (
          <MarketplaceSettingsForm view={view} onSaved={setView} />
        ) : error ? (
          <ErrorState title="Couldn't load the settings" message={LOAD_MESSAGES[classifyLoadError(error)]} onRetry={() => void load()} />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2" role="status" aria-label="Loading">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        )}
      </Panel>

      <Panel title="Admin accounts and roles">
        <p className="text-sm text-gray-500">
          Coming with AD7: invite admins, give them roles (moderator, verification officer, category manager, operations,
          support) and switch accounts off. Until then accounts are created on the server.
        </p>
      </Panel>
    </div>
  );
}
