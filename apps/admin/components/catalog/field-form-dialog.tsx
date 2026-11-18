'use client';

import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  CARD_HIGHLIGHT_COUNT, CATALOG_KEY_REGEX, FIELD_APPLIES_TO, FIELD_TYPES, MAX_HIGHLIGHT_RANK,
  type CatalogLevel, type FieldAppliesTo, type FieldType, type TemplateField,
} from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { createField, updateField, type UpdateFieldPatch } from '@/lib/catalog-api';
import { KEY_MESSAGE, toCatalogKey } from '@/lib/catalog-key';
import { OptionsEditor } from './options-editor';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  single_select: 'Single select',
  multi_select: 'Multi select',
  number: 'Number',
  text: 'Text',
  date: 'Date',
};

/** Short names, for the select and the field list badge. */
export const APPLIES_TO_LABELS: Record<FieldAppliesTo, string> = {
  parts: 'Parts',
  machines: 'Machines',
  both: 'Both',
};

/** Longer names, for the read-only line in edit mode. */
const APPLIES_TO_TEXT: Record<FieldAppliesTo, string> = {
  parts: 'Parts only',
  machines: 'Machines only',
  both: 'Parts and machines',
};

/** A part group's fields only reach part listings, so "Machines" makes no sense there. */
export const appliesToChoices = (level: CatalogLevel): FieldAppliesTo[] =>
  level === 'part_group' ? FIELD_APPLIES_TO.filter((a) => a !== 'machines') : [...FIELD_APPLIES_TO];

export const isSelect = (f: Pick<TemplateField, 'type'>) => f.type === 'single_select' || f.type === 'multi_select';

/** An active select no seller can answer: required checks skip it, so "required" isn't enforced until it has an option. */
export const hasNoActiveOptions = (f: TemplateField) =>
  isSelect(f) && f.status === 'active' && !f.options.some((o) => o.status === 'active');

export function RequiredSelectWarning() {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12.5px] font-medium text-amber-700">
      <AlertTriangle size={13} aria-hidden className="mt-px shrink-0 text-amber-600" />
      <span>Required, but no active options: sellers can skip it until one is added.</span>
    </p>
  );
}

const RANKS = Array.from({ length: MAX_HIGHLIGHT_RANK }, (_, i) => i + 1);

const optionalNumber = z.string().trim().refine((s) => s === '' || Number.isFinite(Number(s)), 'Enter a number');

const schemaFor = (mode: 'create' | 'edit') =>
  z
    .object({
      label: z.string().trim().min(1, 'Enter a label').max(120, 'At most 120 characters'),
      key: z.string().trim(),
      helpText: z.string().trim().max(500, 'At most 500 characters'),
      type: z.enum(FIELD_TYPES),
      appliesTo: z.enum(FIELD_APPLIES_TO),
      unit: z.string().trim().max(20, 'At most 20 characters'),
      min: optionalNumber,
      max: optionalNumber,
      required: z.boolean(),
      filterable: z.boolean(),
      highlightRank: z.string(),
    })
    .superRefine((v, ctx) => {
      if (mode === 'create' && !CATALOG_KEY_REGEX.test(v.key)) ctx.addIssue({ code: 'custom', path: ['key'], message: KEY_MESSAGE });
      if (v.type === 'number' && v.min !== '' && v.max !== '' && Number(v.min) > Number(v.max)) {
        ctx.addIssue({ code: 'custom', path: ['max'], message: 'Max must not be below min' });
      }
    });
type Values = z.infer<ReturnType<typeof schemaFor>>;

export type FieldFormDialogProps =
  | {
      mode: 'create';
      categoryId: string;
      /** The node's level: a part group offers no "Machines" applies-to. */
      nodeLevel: CatalogLevel;
      field?: undefined;
      onClose: () => void;
      onSaved: (field: TemplateField) => void;
    }
  | {
      mode: 'edit';
      field: TemplateField;
      onClose: () => void;
      onSaved: (field: TemplateField) => void;
      /** An option was added, renamed, retired or moved (saved at once, not with the form). */
      onOptionsChanged: () => Promise<void> | void;
    };

const inputCls = 'w-full rounded-lg border-gray-300 text-sm';
const labelCls = 'mb-1.5 block text-[13.5px] font-semibold text-gray-900';
const errorCls = 'mt-1 text-xs text-red-700';

const num = (s: string) => (s.trim() === '' ? null : Number(s));
const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** Add or edit a template field. Key, type and applies-to are set once, on create. Mount it to open it. */
export function FieldFormDialog(props: FieldFormDialogProps) {
  const { mode, field, onClose, onSaved } = props;
  // Once the admin types a key, the label stops rewriting it.
  const keyTouched = useRef(false);

  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schemaFor(mode)),
    defaultValues: {
      label: field?.label ?? '',
      key: field?.key ?? '',
      helpText: field?.helpText ?? '',
      type: field?.type ?? 'single_select',
      // A part group's fields reach part forms only, so 'parts' says what 'both' would mean there.
      appliesTo: field?.appliesTo ?? (mode === 'create' && props.nodeLevel === 'part_group' ? 'parts' : 'both'),
      unit: field?.unit ?? '',
      min: field?.min != null ? String(field.min) : '',
      max: field?.max != null ? String(field.max) : '',
      required: field?.required ?? false,
      filterable: field?.filterable ?? false,
      highlightRank: field?.highlightRank != null ? String(field.highlightRank) : '',
    },
  });
  const type = watch('type');
  const required = watch('required');
  const isNumber = type === 'number';

  const save = async (v: Values) => {
    const rank = v.highlightRank === '' ? null : Number(v.highlightRank);
    const numberBits = isNumber
      ? { unit: blankToNull(v.unit), min: num(v.min), max: num(v.max) }
      : { unit: null, min: null, max: null };
    try {
      let saved: TemplateField;
      if (mode === 'create') {
        saved = await createField(props.categoryId, {
          key: v.key,
          label: v.label,
          helpText: blankToNull(v.helpText),
          type: v.type,
          appliesTo: v.appliesTo,
          ...(isNumber ? numberBits : {}),
          required: v.required,
          filterable: v.filterable,
          highlightRank: rank,
        });
        toast.success('Field added');
      } else {
        const f = props.field;
        const next: Required<Omit<UpdateFieldPatch, 'status'>> = {
          label: v.label, helpText: blankToNull(v.helpText), ...numberBits,
          required: v.required, filterable: v.filterable, highlightRank: rank,
        };
        const patch: UpdateFieldPatch = {};
        for (const k of Object.keys(next) as Array<keyof typeof next>) {
          if (next[k] !== f[k]) (patch as Record<string, unknown>)[k] = next[k];
        }
        if (Object.keys(patch).length === 0) { onClose(); return; }
        saved = await updateField(f.id, patch);
        toast.success('Field saved');
      }
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'KEY_TAKEN') {
        setError('key', { message: 'This key is already used in a template this field belongs to' });
      } else if (err instanceof ApiError && err.code === 'RANK_TAKEN') {
        setError('highlightRank', { message: `Rank ${rank} is already used in a template this field belongs to` });
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not save the field');
      }
    }
  };

  const labelField = register('label', {
    onChange: (e: { target: { value: string } }) => {
      if (mode === 'create' && !keyTouched.current) setValue('key', toCatalogKey(e.target.value), { shouldDirty: true });
    },
  });
  const keyField = register('key', { onChange: () => { keyTouched.current = true; } });

  return (
    <FormDialog
      open
      onClose={onClose}
      title={mode === 'create' ? 'Add field' : `Edit ${field!.label}`}
      size="lg"
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel={mode === 'create' ? 'Add field' : 'Save'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-4">
        {mode === 'edit' && (
          <p className="text-sm text-gray-500">
            Key <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{field!.key}</code>
            {' · '}{FIELD_TYPE_LABELS[field!.type]}
            {' · '}{APPLIES_TO_TEXT[field!.appliesTo]}
            <span className="ml-1 text-xs text-gray-500">(fixed once created)</span>
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="field-label" className={labelCls}>Label</label>
            <input id="field-label" className={inputCls} autoComplete="off" {...labelField} />
            {errors.label && <p className={errorCls}>{errors.label.message}</p>}
          </div>
          {mode === 'create' && (
            <div>
              <label htmlFor="field-key" className={labelCls}>Key</label>
              <input id="field-key" className={`${inputCls} font-mono`} autoComplete="off" spellCheck={false} {...keyField} />
              {errors.key && <p className={errorCls}>{errors.key.message}</p>}
            </div>
          )}
          {mode === 'create' && (
            <div>
              <label htmlFor="field-type" className={labelCls}>Type</label>
              <select id="field-type" className={inputCls} {...register('type')}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          )}
          {mode === 'create' && (
            <div>
              <label htmlFor="field-applies" className={labelCls}>Applies to</label>
              <select id="field-applies" className={inputCls} aria-describedby="field-applies-hint" {...register('appliesTo')}>
                {appliesToChoices(props.nodeLevel).map((a) => <option key={a} value={a}>{APPLIES_TO_LABELS[a]}</option>)}
              </select>
              <p id="field-applies-hint" className="mt-1 text-[12.5px] text-gray-500">Which listings ask for it: spare parts, machines (sale and rent) or both.</p>
            </div>
          )}
          <div>
            <label htmlFor="field-rank" className={labelCls}>Highlight rank</label>
            <select id="field-rank" className={inputCls} {...register('highlightRank')}>
              <option value="">None</option>
              {RANKS.map((r) => (
                <option key={r} value={String(r)}>{r} · {r <= CARD_HIGHLIGHT_COUNT ? 'card and listing page' : 'listing page'}</option>
              ))}
            </select>
            {errors.highlightRank && <p className={errorCls}>{errors.highlightRank.message}</p>}
          </div>
        </div>

        {isNumber && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="field-unit" className={labelCls}>Unit</label>
              <input id="field-unit" className={inputCls} placeholder="e.g. mm" autoComplete="off" {...register('unit')} />
              {errors.unit && <p className={errorCls}>{errors.unit.message}</p>}
            </div>
            <div>
              <label htmlFor="field-min" className={labelCls}>Min</label>
              <input id="field-min" className={inputCls} inputMode="decimal" autoComplete="off" {...register('min')} />
              {errors.min && <p className={errorCls}>{errors.min.message}</p>}
            </div>
            <div>
              <label htmlFor="field-max" className={labelCls}>Max</label>
              <input id="field-max" className={inputCls} inputMode="decimal" autoComplete="off" {...register('max')} />
              {errors.max && <p className={errorCls}>{errors.max.message}</p>}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="field-help" className={labelCls}>Help text <span className="font-normal text-gray-500">(optional)</span></label>
          <input id="field-help" className={inputCls} autoComplete="off" {...register('helpText')} />
          {errors.helpText && <p className={errorCls}>{errors.helpText.message}</p>}
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" className="rounded border-gray-300 text-brand-600" {...register('required')} /> Required
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" className="rounded border-gray-300 text-brand-600" {...register('filterable')} /> Filterable in search
          </label>
        </div>

        {mode === 'create' && (type === 'single_select' || type === 'multi_select') && (
          <p className="text-[12.5px] text-gray-500">Add the options after saving: open the field again with Edit.</p>
        )}
        {mode === 'edit' && required && hasNoActiveOptions(field!) && <RequiredSelectWarning />}
        {mode === 'edit' && isSelect(field!) && (
          <OptionsEditor field={field!} onChanged={props.onOptionsChanged} />
        )}
      </div>
    </FormDialog>
  );
}
