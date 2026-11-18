'use client';

import { CARD_HIGHLIGHT_COUNT, type TemplateField, type TemplateKind } from '@mpm/shared-types';
import { hasNoActiveOptions } from './field-form-dialog';

const disabledInput = 'w-full rounded-lg border-gray-300 bg-gray-50 text-sm text-gray-500';

/** Whether a field is asked on a listing of this kind: parts read parts + both, machines read machines + both. */
export const appliesToKind = (f: Pick<TemplateField, 'appliesTo'>, kind: TemplateKind) =>
  f.appliesTo === 'both' || (kind === 'part' ? f.appliesTo === 'parts' : f.appliesTo === 'machines');

/**
 * The specs part of the seller's "Sell" form as this template would render it for one listing
 * kind: active fields that apply to the kind, in order, active options only, every control disabled.
 */
export function SpecFormPreview({ fields, kind }: { fields: TemplateField[]; kind: TemplateKind }) {
  const active = fields.filter((f) => f.status === 'active' && appliesToKind(f, kind));
  if (active.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">No fields to fill in yet.</p>;
  }

  return (
    <div className="max-w-[460px] space-y-4 rounded-[14px] border border-gray-200 bg-white p-[18px]">
      {active.map((f) => {
        const inputId = `preview-${f.id}`;
        return (
          <div key={f.id} data-preview-field>
            <div className="mb-1.5 flex items-center gap-2">
              <label htmlFor={inputId} className="text-sm font-medium text-gray-900">
                <span>{f.label}</span>
                {f.required && !hasNoActiveOptions(f) && <span className="ml-0.5 text-red-700">*</span>}
              </label>
              {f.highlightRank !== null && (
                <span className="rounded-[10px] bg-brand-50 px-2 text-xs font-bold text-brand-800">
                  {f.highlightRank <= CARD_HIGHLIGHT_COUNT ? 'On card' : 'Listing page'}
                </span>
              )}
            </div>
            <Control field={f} id={inputId} />
            {f.helpText && <p className="mt-1 text-[12.5px] text-gray-500">{f.helpText}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Control({ field: f, id }: { field: TemplateField; id: string }) {
  switch (f.type) {
    case 'single_select':
    case 'multi_select': {
      const options = f.options.filter((o) => o.status === 'active');
      return (
        <div id={id} role="group" aria-label={f.label} className="flex flex-wrap gap-1.5">
          {options.length === 0 && <span className="text-xs text-gray-500">No options yet</span>}
          {options.map((o) => (
            <span key={o.id} className="rounded-full border border-gray-300 px-[11px] py-[3px] text-[13px] text-gray-900">{o.label}</span>
          ))}
          {f.type === 'multi_select' && options.length > 0 && <span className="self-center text-xs text-gray-500">Pick any</span>}
        </div>
      );
    }
    case 'number': {
      const range = f.min !== null && f.max !== null ? `${f.min} – ${f.max}`
        : f.min !== null ? `${f.min} or more` : f.max !== null ? `Up to ${f.max}` : null;
      return (
        <div className="flex items-center gap-2">
          <input id={id} type="number" disabled className={disabledInput} placeholder={range ?? undefined} />
          {f.unit && <span className="shrink-0 text-sm font-medium text-gray-600">{f.unit}</span>}
        </div>
      );
    }
    case 'date':
      return <input id={id} type="date" disabled className={disabledInput} />;
    case 'text':
      return <input id={id} type="text" disabled className={disabledInput} />;
  }
}
