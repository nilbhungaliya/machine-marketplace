import * as Yup from 'yup';
import type { Specs, TemplateField } from '@mpm/shared-types';
import { toAsciiDigits } from './digits';

// Template fields → form controls and Yup rules (F2 spec §5.2 "Template fields"; A4 §5's `validateSpecs` on the API is
// the authority, this mirrors it so the seller sees problems before Next). Pure. Form values are strings (number and
// date inputs keep the raw text, Hindi / Gujarati digits included) and string arrays (multi-select option keys).

/** `single_select` → radio chips, `multi_select` → checkbox chips, `number` → input with the unit as suffix… */
export type SpecControl = 'chips-radio' | 'chips-multi' | 'number' | 'text' | 'date';

/** The API's text limit for a spec value (`TEXT_MAX` in `apps/api/src/lib/spec-check.ts`). */
export const SPEC_TEXT_MAX = 200;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type SpecFormValues = Record<string, string | string[]>;

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function specControl(field: Pick<TemplateField, 'type'>): SpecControl {
  switch (field.type) {
    case 'single_select': return 'chips-radio';
    case 'multi_select': return 'chips-multi';
    case 'number': return 'number';
    case 'date': return 'date';
    case 'text': return 'text';
  }
}

/** The fields a seller fills: active ones, in template order (the API serves them in order). */
export function editableFields(fields: readonly TemplateField[]): TemplateField[] {
  return fields.filter((f) => f.status === 'active');
}

/** A field's active options, in order (retired options stay readable on old listings but aren't offered). */
export function activeOptions(field: TemplateField) {
  return field.options.filter((o) => o.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Typed number text → number, or null for empty / not a number. */
export function parseSpecNumber(text: string): number | null {
  const clean = toAsciiDigits(text).replace(/[,\s]/g, '');
  if (clean === '' || !/^-?\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}

/** A real `YYYY-MM-DD` date. */
export function isSpecDate(text: string): boolean {
  const m = DATE_RE.exec(toAsciiDigits(text.trim()));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return y >= 100 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Initial form values from a listing's stored specs (numbers as text). */
export function specInitialValues(fields: readonly TemplateField[], specs: Specs | null | undefined): SpecFormValues {
  const values: SpecFormValues = {};
  for (const f of editableFields(fields)) {
    const v = specs?.[f.key];
    if (f.type === 'multi_select') values[f.key] = Array.isArray(v) ? v.map(String) : [];
    else values[f.key] = v == null || Array.isArray(v) ? '' : String(v);
  }
  return values;
}

/**
 * The Yup schema of a template. `enforceRequired: false` leaves required fields to publish (a draft PATCH allows them
 * empty, §4.2); the wizard's Next enforces them by default.
 */
export function buildSpecSchema(fields: readonly TemplateField[], t: Translate, opts: { enforceRequired?: boolean } = {}) {
  const enforce = opts.enforceRequired ?? true;
  const shape: Record<string, Yup.AnySchema> = {};
  for (const f of editableFields(fields)) {
    const required = enforce && f.required;
    switch (specControl(f)) {
      case 'chips-multi': {
        let s = Yup.array().of(Yup.string().required());
        if (required) s = s.min(1, t('sell.validation.pickAtLeastOne'));
        shape[f.key] = s;
        break;
      }
      case 'chips-radio': {
        shape[f.key] = required ? Yup.string().required(t('sell.validation.pickOne')) : Yup.string();
        break;
      }
      case 'number': {
        let s = Yup.string()
          .test('number', t('sell.validation.number'), (v) => !v || parseSpecNumber(v) !== null)
          .test('min', t('sell.validation.min', { min: f.min }), (v) => !v || f.min === null || (parseSpecNumber(v) ?? f.min) >= f.min)
          .test('max', t('sell.validation.max', { max: f.max }), (v) => !v || f.max === null || (parseSpecNumber(v) ?? f.max) <= f.max);
        if (required) s = s.required(t('sell.validation.required'));
        shape[f.key] = s;
        break;
      }
      case 'date': {
        let s = Yup.string().test('date', t('sell.validation.date'), (v) => !v || isSpecDate(v));
        if (required) s = s.required(t('sell.validation.required'));
        shape[f.key] = s;
        break;
      }
      case 'text': {
        let s = Yup.string().trim().max(SPEC_TEXT_MAX, t('sell.validation.textMax', { max: SPEC_TEXT_MAX }));
        if (required) s = s.required(t('sell.validation.required'));
        shape[f.key] = s;
        break;
      }
    }
  }
  return Yup.object(shape);
}

/**
 * Form values → the `specs` of a PATCH: numbers parsed, text trimmed, dates in ASCII digits, empty values left out
 * (a key left out is cleared). The form edits only the template's active fields; PATCH replaces `specs` whole, so every
 * stored key the form doesn't edit (a retired field, which the public template no longer serves, or a key gone from
 * the template) is carried over from `previous` unchanged (spec §7.3: untouched retired values pass).
 */
export function toSpecs(values: SpecFormValues, fields: readonly TemplateField[], previous?: Specs | null): Specs {
  const editable = new Set(editableFields(fields).map((f) => f.key));
  const specs: Specs = {};
  for (const [key, value] of Object.entries(previous ?? {})) {
    if (!editable.has(key)) specs[key] = value;
  }
  for (const f of editableFields(fields)) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) specs[f.key] = v;
      continue;
    }
    const text = v.trim();
    if (text === '') continue;
    if (f.type === 'number') {
      const n = parseSpecNumber(text);
      if (n !== null) specs[f.key] = n;
    } else if (f.type === 'date') {
      specs[f.key] = toAsciiDigits(text);
    } else {
      specs[f.key] = text;
    }
  }
  return specs;
}
