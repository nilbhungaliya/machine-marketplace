import { isDeepStrictEqual } from 'node:util';
import type { EffectiveTemplate, SpecErrorCode, Specs, TemplateField } from '@mpm/shared-types';

export type SpecCheckResult = { ok: true } | { ok: false; errors: Record<string, SpecErrorCode> };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TEXT_MAX = 200;

/** Postgres refuses a NUL in text and in jsonb, and a lone surrogate in jsonb (a text column would store U+FFFD instead). */
export function isStorableText(value: string): boolean {
  return !/[\u0000\p{Cs}]/u.test(value);
}

/** Missing, null, '' and [] all count as "no value". */
export function isEmptySpecValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Own property only, so a field keyed e.g. `constructor` never reads Object.prototype. */
function own(specs: Specs | undefined, key: string): unknown {
  return specs && Object.hasOwn(specs, key) ? specs[key] : undefined;
}

/** A real calendar date, `YYYY-MM-DD`, years 0100 and up. */
export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Checks one non-empty value against its field. Returns the error, or null when valid.
 * `retired` is returned for a retired field or a retired option; the caller lets it pass
 * when the value is unchanged from the previous specs.
 */
function checkValue(field: TemplateField, value: unknown): SpecErrorCode | null {
  if (field.status === 'retired') return 'retired';

  switch (field.type) {
    case 'single_select':
    case 'multi_select': {
      const keys = field.type === 'single_select' ? (typeof value === 'string' ? [value] : null) : value;
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) return 'invalid_option';
      if (new Set(keys).size !== keys.length) return 'invalid_option';
      const options = new Map(field.options.map((o) => [o.key, o.status]));
      if (keys.some((k: string) => !options.has(k))) return 'invalid_option';
      if (keys.some((k: string) => options.get(k) === 'retired')) return 'retired';
      return null;
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'not_a_number';
      if (field.min !== null && value < field.min) return 'below_min';
      if (field.max !== null && value > field.max) return 'above_max';
      return null;
    case 'date':
      return typeof value === 'string' && isRealDate(value) ? null : 'invalid_date';
    case 'text': {
      if (typeof value !== 'string' || !isStorableText(value)) return 'invalid_text';
      const length = value.trim().length;
      return length >= 1 && length <= TEXT_MAX ? null : 'invalid_text';
    }
    default:
      // A new FieldType must get a case above (compile error); at run time an unknown one fails closed.
      field.type satisfies never;
      return 'unsupported_type';
  }
}

/** Unchanged from the previous specs. A multi_select value is a set, so its order doesn't count. */
function isUnchanged(field: TemplateField, previous: unknown, value: unknown): boolean {
  if (field.type === 'multi_select' && Array.isArray(previous) && Array.isArray(value)) {
    return isDeepStrictEqual([...previous].sort(), [...value].sort());
  }
  return isDeepStrictEqual(previous, value);
}

/** A select with no active option can't be filled in, so it can't block a listing. */
export function isRequiredField(field: TemplateField): boolean {
  if (field.status !== 'active' || !field.required) return false;
  const isSelect = field.type === 'single_select' || field.type === 'multi_select';
  return !isSelect || field.options.some((o) => o.status === 'active');
}

/**
 * Validates lot specs against an effective template. `template` must include retired fields and
 * options (loadTemplate with includeRetired: true), so their values are reported as `retired`
 * rather than `unknown_field` / `invalid_option`. With `previousSpecs` (editing a lot), a value
 * unchanged from its previous value passes even if its field or option has since been retired.
 * Empty values (missing, null, '', []) are only an error on an active required field that can be
 * filled in. `errors` is a plain object; keys come from the client, so one may be `__proto__`.
 */
export function checkSpecs(template: EffectiveTemplate, specs: Specs, previousSpecs?: Specs): SpecCheckResult {
  const fields = new Map(template.fields.map((f) => [f.key, f]));
  // No prototype while collecting: assigning a client's `__proto__` key must add a key, not hit the setter.
  const errors = Object.create(null) as Record<string, SpecErrorCode>;

  for (const [key, value] of Object.entries(specs)) {
    const field = fields.get(key);
    if (!field) {
      errors[key] = 'unknown_field';
      continue;
    }
    if (isEmptySpecValue(value)) continue;
    const error = checkValue(field, value);
    if (error === 'retired' && isUnchanged(field, own(previousSpecs, key), value)) continue;
    if (error) errors[key] = error;
  }

  for (const field of template.fields) {
    if (isRequiredField(field) && isEmptySpecValue(own(specs, field.key))) errors[field.key] = 'required';
  }

  // fromEntries defines own properties, so a `__proto__` key survives the copy.
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors: Object.fromEntries(Object.entries(errors)) };
}
