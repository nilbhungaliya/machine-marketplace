import { describe, expect, it } from 'vitest';
import type { CatalogStatus, EffectiveTemplate, FieldType, Specs, TemplateField } from '@mpm/shared-types';
import { checkSpecs } from './spec-check.js';

function field(
  key: string,
  type: FieldType,
  extra: Partial<Omit<TemplateField, 'options'>> & { options?: [string, CatalogStatus][] } = {},
): TemplateField {
  const { options = [], ...rest } = extra;
  return {
    id: `f_${key}`,
    categoryId: 'c1',
    key,
    label: key,
    helpText: null,
    appliesTo: 'both',
    type,
    unit: null,
    min: null,
    max: null,
    required: false,
    filterable: false,
    highlightRank: null,
    sortOrder: 0,
    status: 'active',
    ...rest,
    options: options.map(([k, status], i) => ({ id: `o_${k}`, key: k, label: k, sortOrder: i, status })),
  };
}

const template: EffectiveTemplate = {
  nodeId: 'pt1',
  kind: 'part',
  fields: [
    field('gsm', 'number', { min: 20, max: 600, required: true }),
    field('composition', 'single_select', {
      required: true,
      options: [['cotton_100', 'active'], ['pc_6535', 'retired']],
    }),
    field('properties', 'multi_select', { options: [['stretch', 'active'], ['waterproof', 'active']] }),
    field('expiry', 'date'),
    field('note', 'text'),
    field('old_note', 'text', { status: 'retired' }),
  ],
};

const valid: Specs = {
  gsm: 110,
  composition: 'cotton_100',
  properties: ['stretch', 'waterproof'],
  expiry: '2027-02-28',
  note: '60s poplin',
};

const templateOf = (...fields: TemplateField[]): EffectiveTemplate => ({ nodeId: 'pt1', kind: 'part', fields });

function errorsOf(specs: Specs, previous?: Specs) {
  const result = checkSpecs(template, specs, previous);
  return result.ok ? {} : result.errors;
}

describe('checkSpecs', () => {
  it('accepts valid full specs', () => {
    expect(checkSpecs(template, valid)).toEqual({ ok: true });
  });

  it('accepts specs with only the required fields', () => {
    expect(checkSpecs(template, { gsm: 110, composition: 'cotton_100' })).toEqual({ ok: true });
  });

  it('flags a missing required field', () => {
    const { gsm: _gsm, ...rest } = valid;
    expect(errorsOf(rest).gsm).toBe('required');
  });

  it('treats an empty string or empty array as missing for a required field', () => {
    expect(errorsOf({ ...valid, composition: '' }).composition).toBe('required');
    const multiRequired: EffectiveTemplate = {
      nodeId: 'pt1',
      kind: 'part',
      fields: [field('properties', 'multi_select', { required: true, options: [['stretch', 'active']] })],
    };
    const result = checkSpecs(multiRequired, { properties: [] });
    expect(result.ok ? {} : result.errors).toEqual({ properties: 'required' });
  });

  it('flags a key that is not in the template', () => {
    expect(errorsOf({ ...valid, extra: 1 }).extra).toBe('unknown_field');
  });

  it('flags a select value that is not an option', () => {
    expect(errorsOf({ ...valid, composition: 'linen' }).composition).toBe('invalid_option');
    expect(errorsOf({ ...valid, properties: ['stretch', 'x'] }).properties).toBe('invalid_option');
  });

  it('flags select values of the wrong shape', () => {
    expect(errorsOf({ ...valid, composition: ['cotton_100'] }).composition).toBe('invalid_option');
    expect(errorsOf({ ...valid, properties: 'stretch' }).properties).toBe('invalid_option');
  });

  it('flags a number field that is not a finite number', () => {
    expect(errorsOf({ ...valid, gsm: '110' }).gsm).toBe('not_a_number');
    expect(errorsOf({ ...valid, gsm: Number.NaN }).gsm).toBe('not_a_number');
    expect(errorsOf({ ...valid, gsm: Number.POSITIVE_INFINITY }).gsm).toBe('not_a_number');
  });

  it('flags numbers outside min/max', () => {
    expect(errorsOf({ ...valid, gsm: 10 }).gsm).toBe('below_min');
    expect(errorsOf({ ...valid, gsm: 900 }).gsm).toBe('above_max');
    expect(checkSpecs(template, { ...valid, gsm: 20 })).toEqual({ ok: true });
    expect(checkSpecs(template, { ...valid, gsm: 600 })).toEqual({ ok: true });
  });

  it('flags a date that is not a real YYYY-MM-DD calendar date', () => {
    expect(errorsOf({ ...valid, expiry: '2026-02-30' }).expiry).toBe('invalid_date');
    expect(errorsOf({ ...valid, expiry: '2026-2-3' }).expiry).toBe('invalid_date');
    expect(errorsOf({ ...valid, expiry: '2026-02-28T00:00:00Z' }).expiry).toBe('invalid_date');
    expect(checkSpecs(template, { ...valid, expiry: '2028-02-29' })).toEqual({ ok: true });
  });

  it('flags blank or over-long text', () => {
    expect(errorsOf({ ...valid, note: '   ' }).note).toBe('invalid_text');
    expect(errorsOf({ ...valid, note: 'x'.repeat(201) }).note).toBe('invalid_text');
    expect(errorsOf({ ...valid, note: 5 }).note).toBe('invalid_text');
    expect(checkSpecs(template, { ...valid, note: 'x'.repeat(200) })).toEqual({ ok: true });
  });

  it('flags text Postgres cannot store: a NUL or a lone surrogate', () => {
    expect(errorsOf({ ...valid, note: 'a\u0000b' }).note).toBe('invalid_text');
    expect(errorsOf({ ...valid, note: 'a\ud800b' }).note).toBe('invalid_text');
    expect(checkSpecs(template, { ...valid, note: 'नमस्ते 😀' })).toEqual({ ok: true });
  });

  it('rejects a retired option unless unchanged from the previous specs', () => {
    expect(errorsOf({ ...valid, composition: 'pc_6535' }).composition).toBe('retired');
    expect(checkSpecs(template, { ...valid, composition: 'pc_6535' }, { composition: 'pc_6535' })).toEqual({ ok: true });
  });

  it('rejects a value on a retired field unless unchanged from the previous specs', () => {
    expect(errorsOf({ ...valid, old_note: 'x' }).old_note).toBe('retired');
    expect(checkSpecs(template, { ...valid, old_note: 'x' }, { old_note: 'x' })).toEqual({ ok: true });
    expect(errorsOf({ ...valid, old_note: 'x' }, { old_note: 'y' }).old_note).toBe('retired');
  });

  it('does not require a retired required field', () => {
    const retiredRequired: EffectiveTemplate = {
      nodeId: 'pt1',
      kind: 'part',
      fields: [field('batch', 'text', { required: true, status: 'retired' })],
    };
    expect(checkSpecs(retiredRequired, {})).toEqual({ ok: true });
  });

  it('does not require a required select that has no active options', () => {
    for (const type of ['single_select', 'multi_select'] as const) {
      const noneActive = templateOf(field('weave', type, { required: true, options: [['twill', 'retired']] }));
      expect(checkSpecs(noneActive, {})).toEqual({ ok: true });

      const oneActive = templateOf(field('weave', type, { required: true, options: [['twill', 'retired'], ['plain', 'active']] }));
      const result = checkSpecs(oneActive, {});
      expect(result.ok ? {} : result.errors).toEqual({ weave: 'required' });
    }
  });

  it('reports prototype-named keys as unknown fields', () => {
    const specs = JSON.parse('{"__proto__":1,"constructor":"x","toString":"y"}') as Specs;
    const result = checkSpecs(templateOf(), specs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    for (const key of Object.keys(result.errors)) expect(result.errors[key]).toBe('unknown_field');
    // A plain object: it serialises, own `__proto__` key included, without having changed its prototype.
    expect(Object.getPrototypeOf(result.errors)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(result.errors))).toHaveProperty(['__proto__'], 'unknown_field');
  });

  it('fails closed on a field type it does not know', () => {
    const colour = templateOf(field('shade', 'colour' as FieldType));
    const result = checkSpecs(colour, { shade: 'red' });
    expect(result.ok ? {} : result.errors).toEqual({ shade: 'unsupported_type' });
  });

  it('compares a retired multi_select value as a set', () => {
    const multi = templateOf(field('finish', 'multi_select', { options: [['a', 'retired'], ['b', 'active'], ['c', 'active']] }));
    const previous: Specs = { finish: ['b', 'a'] };
    expect(checkSpecs(multi, { finish: ['a', 'b'] }, previous)).toEqual({ ok: true });
    for (const finish of [['a', 'b', 'c'], ['a']]) {
      const result = checkSpecs(multi, { finish }, previous);
      expect(result.ok ? {} : result.errors).toEqual({ finish: 'retired' });
    }
  });

  it('a retired value is changed when the previous value is not a list', () => {
    const multi = templateOf(field('finish', 'multi_select', { options: [['a', 'retired']] }));
    const result = checkSpecs(multi, { finish: ['a'] }, { finish: 'a' });
    expect(result.ok ? {} : result.errors).toEqual({ finish: 'retired' });
  });

  it('reports every failing field at once', () => {
    expect(errorsOf({ gsm: 10, composition: 'linen', extra: 'y' })).toEqual({
      gsm: 'below_min',
      composition: 'invalid_option',
      extra: 'unknown_field',
    });
  });
});
