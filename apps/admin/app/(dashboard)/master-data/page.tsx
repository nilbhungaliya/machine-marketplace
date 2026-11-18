'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MasterData, Unit } from '@mpm/shared-types';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { ExportButton } from '@/components/catalog/export-button';
import { FixedLists } from '@/components/catalog/fixed-lists';
import { KeyedListEditor, unitDecimalsColumn, unitDecimalsExtras } from '@/components/catalog/keyed-list-editor';
import {
  createCondition, createUnit, fetchAdminMasterData, reorderConditions, reorderUnits, updateCondition, updateUnit,
} from '@/lib/catalog-api';
import { useTabParam } from '@/lib/use-tab-param';

const TAB_KEYS = ['units', 'conditions', 'fixed'] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** A4: units and conditions (admin lists), and the fixed lists sellers pick from. */
export default function MasterDataPage() {
  const [data, setData] = useState<MasterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab, ready] = useTabParam(TAB_KEYS);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchAdminMasterData());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the units and conditions');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Runs a write, then reloads; errors go to the caller (the editors show them). */
  const write = useCallback(async (work: () => Promise<unknown>) => {
    await work();
    await load();
  }, [load]);

  const tabs: Array<{ value: TabKey; label: string; count?: number }> = [
    { value: 'units', label: 'Units', count: data?.units.length },
    { value: 'conditions', label: 'Conditions', count: data?.conditions.length },
    { value: 'fixed', label: 'Fixed lists' },
  ];

  return (
    <div>
      <PageHeader
        title="Units, conditions & sides"
        description="The units and conditions sellers pick from, and the fixed lists (sides, price models, rental periods)."
        actions={<ExportButton sheet="master-data" label="Export master data CSV" />}
      />

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'fixed' && ready ? (
        <FixedLists />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data || !ready ? (
        <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={4} /></div>
      ) : tab === 'units' ? (
        <KeyedListEditor<Unit, number>
          noun="unit"
          items={data.units}
          extraColumns={[unitDecimalsColumn]}
          extras={unitDecimalsExtras}
          onCreate={(v) => write(() => createUnit({ key: v.key, label: v.label, decimals: v.extra }))}
          onUpdate={(item, p) => write(() => updateUnit(item.id, { label: p.label, isActive: p.isActive, decimals: p.extra }))}
          onReorder={(ids) => write(() => reorderUnits(ids))}
          onReload={load}
        />
      ) : (
        <KeyedListEditor
          noun="condition"
          items={data.conditions}
          withDescription
          onCreate={(v) => write(() => createCondition({ key: v.key, label: v.label, description: v.description }))}
          onUpdate={(item, p) => write(() => updateCondition(item.id, { label: p.label, description: p.description, isActive: p.isActive }))}
          onReorder={(ids) => write(() => reorderConditions(ids))}
          onReload={load}
        />
      )}
    </div>
  );
}
