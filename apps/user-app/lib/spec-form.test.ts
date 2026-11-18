import { describe, expect, it } from 'vitest';
import type { TemplateField } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import {
  activeOptions, buildSpecSchema, isSpecDate, parseSpecNumber, specControl, specInitialValues, toSpecs,
} from './spec-form';

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o);

const field = (over: Partial<TemplateField>): TemplateField => ({
  id: 'f', categoryId: 'c', key: 'k', label: 'L', helpText: null, type: 'text', appliesTo: 'both', unit: null, min: null,
  max: null, required: false, filterable: false, highlightRank: null, sortOrder: 0, status: 'active', options: [], ...over,
});

const FIELDS: TemplateField[] = [
  field({ key: 'width', type: 'number', unit: 'cm', min: 100, max: 400, required: true }),
  field({
    key: 'shed', type: 'single_select', required: true,
    options: [
      { id: 'o2', key: 'cam', label: 'Cam', sortOrder: 1, status: 'active' },
      { id: 'o1', key: 'dobby', label: 'Dobby', sortOrder: 0, status: 'active' },
      { id: 'o3', key: 'old', label: 'Old', sortOrder: 2, status: 'retired' },
    ],
  }),
  field({ key: 'feeds', type: 'multi_select', options: [{ id: 'o4', key: 'a', label: 'A', sortOrder: 0, status: 'active' }] }),
  field({ key: 'made', type: 'date' }),
  field({ key: 'note', type: 'text' }),
  field({ key: 'gone', type: 'text', status: 'retired' }),
];

describe('specControl', () => {
  it('maps every field type', () => {
    expect(FIELDS.slice(0, 5).map(specControl)).toEqual(['number', 'chips-radio', 'chips-multi', 'date', 'text']);
  });
  it('offers active options in order', () => {
    expect(activeOptions(FIELDS[1]!).map((o) => o.key)).toEqual(['dobby', 'cam']);
  });
});

describe('values', () => {
  it('initial values from stored specs; retired fields left out', () => {
    expect(specInitialValues(FIELDS, { width: 190, shed: 'cam', feeds: ['a'], gone: 'x' })).toEqual({
      width: '190', shed: 'cam', feeds: ['a'], made: '', note: '',
    });
  });
  it('toSpecs parses numbers (Gujarati digits), trims and drops empties', () => {
    expect(toSpecs({ width: '૧૯૦.૫', shed: 'cam', feeds: [], made: '२०२०-03-05', note: '  hi  ', gone: 'x' }, FIELDS)).toEqual({
      width: 190.5, shed: 'cam', made: '2020-03-05', note: 'hi',
    });
  });
  it('toSpecs keeps the stored values of fields the form does not edit (retired, or gone from the template)', () => {
    const previous = { width: 180, shed: 'dobby', note: 'old', gone: 'kept', legacy: ['x'] };
    expect(toSpecs({ width: '200', shed: 'cam', feeds: [], made: '', note: '' }, FIELDS, previous)).toEqual({
      width: 200, shed: 'cam', gone: 'kept', legacy: ['x'],
    });
  });
  it('toSpecs: an editable field cleared in the form is cleared even when stored before', () => {
    expect(toSpecs({ width: '', shed: '', feeds: [], made: '', note: '' }, FIELDS, { note: 'old', width: 190 })).toEqual({});
  });
  it('number and date parsing', () => {
    expect(parseSpecNumber('1,200')).toBe(1200);
    expect(parseSpecNumber('abc')).toBeNull();
    expect(parseSpecNumber('')).toBeNull();
    expect(isSpecDate('2024-02-29')).toBe(true);
    expect(isSpecDate('2023-02-29')).toBe(false);
    expect(isSpecDate('29/02/2024')).toBe(false);
  });
});

describe('buildSpecSchema', () => {
  const schema = buildSpecSchema(FIELDS, t);
  const errors = (values: Record<string, unknown>) => {
    try {
      schema.validateSync(values, { abortEarly: false });
      return {};
    } catch (e) {
      const err = e as { inner: { path: string; message: string }[] };
      return Object.fromEntries(err.inner.map((i) => [i.path, i.message]));
    }
  };
  it('required, number range, date and text rules', () => {
    expect(errors({ width: '', shed: '', feeds: [], made: '', note: '' })).toEqual({
      width: 'This is required.', shed: 'Choose one.',
    });
    expect(errors({ width: '90', shed: 'cam', feeds: [], made: '2020-13-01', note: 'x'.repeat(201) })).toEqual({
      width: 'Enter 100 or more.', made: 'Enter a date as YYYY-MM-DD.', note: 'Keep it under 200 characters.',
    });
    expect(errors({ width: 'abc', shed: 'cam', feeds: [], made: '', note: '' })).toEqual({ width: 'Enter a number.' });
    expect(errors({ width: '190', shed: 'cam', feeds: ['a'], made: '2020-03-05', note: 'ok' })).toEqual({});
  });
  it('a draft save can leave required fields empty', () => {
    const lax = buildSpecSchema(FIELDS, t, { enforceRequired: false });
    expect(lax.isValidSync({ width: '', shed: '', feeds: [], made: '', note: '' })).toBe(true);
    expect(lax.isValidSync({ width: '500', shed: '', feeds: [], made: '', note: '' })).toBe(false);
  });
});
