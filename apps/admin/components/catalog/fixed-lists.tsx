'use client';

import { Lock } from 'lucide-react';
import {
  PART_SIDES, PRICE_MODELS, RENTAL_PERIODS, type PartSide, type PriceModel, type RentalPeriod,
} from '@mpm/shared-types';

// English names for the admin only; the app shows its own translations (en / hi / gu).
const SIDE_LABELS: Record<PartSide, string> = { left: 'Left', right: 'Right', pair: 'Pair', not_applicable: 'Not applicable' };
const PRICE_MODEL_LABELS: Record<PriceModel, string> = { fixed: 'Fixed', negotiable: 'Negotiable', on_request: 'Price on request' };
const RENTAL_PERIOD_LABELS: Record<RentalPeriod, string> = { hour: 'Per hour', day: 'Per day', week: 'Per week', month: 'Per month' };

export const FIXED_LIST_NOTE =
  'Fixed in the app because offers, rentals and matching work differently for each. Their names are translated in the app.';

const LISTS: Array<{ title: string; items: Array<{ key: string; label: string }> }> = [
  { title: 'Sides', items: PART_SIDES.map((k) => ({ key: k, label: SIDE_LABELS[k] })) },
  { title: 'Price models', items: PRICE_MODELS.map((k) => ({ key: k, label: PRICE_MODEL_LABELS[k] })) },
  { title: 'Rental periods', items: RENTAL_PERIODS.map((k) => ({ key: k, label: RENTAL_PERIOD_LABELS[k] })) },
];

/** Read-only: the lists that live in shared-types, not in the database (A4, spec §7). */
export function FixedLists() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {LISTS.map((list) => (
        <section key={list.title} aria-label={list.title} className="rounded-[10px] border border-gray-200 bg-white p-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Lock size={14} aria-hidden className="text-gray-500" /> {list.title}
          </h3>
          <p className="mt-1 text-[13px] text-gray-500">{FIXED_LIST_NOTE}</p>
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {list.items.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-semibold text-gray-900">{it.label}</span>
                <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{it.key}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
