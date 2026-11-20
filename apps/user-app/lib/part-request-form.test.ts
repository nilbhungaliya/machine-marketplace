import { describe, expect, it } from 'vitest';
import type { Fitment, PartRequestBuyerView, QueryReading } from '@mpm/shared-types';
import {
  addDays,
  copyOf,
  emptyRequestValues,
  fromBuyerView,
  prefillFromOtherSide,
  prefillFromReading,
  reachChoices,
  requestFormSchema,
  toPartRequestInput,
  toPartRequestPatch,
  validateRequestForm,
  valuesFromPrefill,
  type RequestFormValues,
} from './part-request-form';

const t = (key: string) => key;
const TODAY = '2026-11-20';
const schema = (hasSides: boolean, unitDecimals: number | null = 0) => requestFormSchema(t, { hasSides, unitDecimals, today: TODAY });

const CAT = '11111111-1111-4111-8111-111111111111';
const UNIT = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const MODEL = '44444444-4444-4444-8444-444444444444';

const filled = (over: Partial<RequestFormValues> = {}): RequestFormValues => ({
  ...emptyRequestValues(15),
  categoryId: CAT,
  name: 'Tie rod end',
  side: 'left',
  quantity: '4',
  unitId: UNIT,
  ...over,
});

const reading = (over: Partial<QueryReading> = {}): QueryReading => ({
  ref: null,
  brand: null,
  model: null,
  category: null,
  partNumbers: [],
  side: null,
  words: [],
  wordGroups: [],
  ...over,
});

describe('prefillFromReading (§13.2)', () => {
  it('takes side, one fit, the part group and the reading words', () => {
    const p = prefillFromReading(
      reading({
        side: 'left',
        brand: { id: BRAND, name: 'Toyota' },
        model: { id: MODEL, name: 'LWT710', brandId: BRAND },
        category: { id: CAT, name: 'Steering', level: 'part_group' },
        words: ['tie', 'rod', 'end'],
      }),
      'left tie rod end toyota lwt710',
      new Set([BRAND]),
    );
    expect(p).toEqual({
      source: 'no_results',
      categoryId: CAT,
      side: 'left',
      fits: [{ brandId: BRAND, modelId: MODEL, yearFrom: null, yearTo: null }],
      name: 'tie rod end',
    });
  });

  it('only seeds the picker with a machine category', () => {
    const p = prefillFromReading(reading({ category: { id: CAT, name: 'Trucks', level: 'machine_category' }, words: ['clutch', 'plate'] }), 'truck clutch plate');
    expect(p.categoryId).toBeUndefined();
    expect(p.categorySeedId).toBe(CAT);
  });

  it('takes the first part number and falls back to the raw query for the name', () => {
    const p = prefillFromReading(reading({ partNumbers: ['AB123X', 'CD456'] }), '  AB-123/X  cd456 ');
    expect(p.partNumber).toBe('AB123X');
    expect(p.name).toBe('AB-123/X cd456');
  });
});

describe('prefillFromOtherSide (§13.2)', () => {
  const fit: Fitment = { brandId: BRAND, brandName: 'Tata', modelId: MODEL, modelName: 'LPT 1613', modelOther: null, yearFrom: 2016, yearTo: null, note: null };
  const listing = { kind: 'part' as const, categoryId: CAT, title: 'Tie rod end LH', partNumber: 'AB-123-L', side: 'left' as const, fitments: [fit] };

  it('asks for the other side with the part number base and the fits', () => {
    expect(prefillFromOtherSide(listing)).toEqual({
      source: 'other_side',
      kind: 'part',
      categoryId: CAT,
      name: 'Tie rod end LH',
      partNumber: 'AB123',
      side: 'right',
      fits: [{ brandId: BRAND, modelId: MODEL, yearFrom: 2016, yearTo: null }],
    });
  });

  it('leaves the side to the buyer for a Pair', () => {
    expect(prefillFromOtherSide({ ...listing, side: 'pair' }).side).toBeUndefined();
  });
});

describe('review fixes', () => {
  it('drops a side the node has no sides for, on post and on save (400 SIDE_NOT_ALLOWED otherwise)', () => {
    expect(toPartRequestInput(filled({ side: 'left' }), { hasSides: false }).side).toBeUndefined();
    expect(toPartRequestInput(filled({ side: 'left' }), { hasSides: true }).side).toBe('left');
    const base = filled({ side: 'left' });
    expect(toPartRequestPatch(base, base, 2, { hasSides: false }).side).toBeNull();
  });

  it('makes a brand chip a fit only for a brand that makes machines', () => {
    const r = reading({ brand: { id: BRAND, name: 'SKF' }, words: ['bearing'] });
    expect(prefillFromReading(r, 'skf bearing', new Set()).fits).toBeUndefined();
    expect(prefillFromReading(r, 'skf bearing', null).fits).toBeUndefined();
  });

  it('keeps the stored past "needed by" of an edited request', () => {
    const past = '2026-01-01';
    const sc = requestFormSchema(t, { hasSides: true, unitDecimals: 0, today: TODAY, baselineNeededBy: past });
    expect(validateRequestForm(sc, filled({ neededBy: past })).neededBy).toBeUndefined();
    expect(validateRequestForm(sc, filled({ neededBy: '2026-01-02' })).neededBy).toBeDefined();
  });
});

describe('toPartRequestInput', () => {
  it('drops empty optionals and keeps the quantity a string', () => {
    const input = toPartRequestInput(filled({ quantity: '1,200.50', partNumber: '  ', note: ' ', budget: '' }));
    expect(input).toEqual({
      kind: 'part',
      categoryId: CAT,
      name: 'Tie rod end',
      quantity: '1200.5',
      reach: 'radius_200',
      audience: 'verified_only',
      validityDays: 15,
      side: 'left',
      unitId: UNIT,
    });
  });

  it('sends a budget with its visibility, conditions when narrowed, photos by key', () => {
    const input = toPartRequestInput(filled({ budget: '₹1,200', budgetVisible: true, conditionIds: ['c1'], photos: [{ key: 'k1', uri: null }] }));
    expect(input.budgetPerUnitPaise).toBe(120_000);
    expect(input.budgetVisible).toBe(true);
    expect(input.conditionIds).toEqual(['c1']);
    expect(input.photoKeys).toEqual(['k1']);
  });

  it('asks for one machine, with no side, unit or part number', () => {
    const input = toPartRequestInput(filled({ kind: 'machine', side: 'left', partNumber: 'X1', quantity: '' }));
    expect(input.quantity).toBe('1');
    expect(input.side).toBeUndefined();
    expect(input.unitId).toBeUndefined();
    expect(input.partNumber).toBeUndefined();
  });
});

describe('requestFormSchema', () => {
  it('refuses a side-less part on a node with sides, and four photos', () => {
    const photos = ['a', 'b', 'c', 'd'].map((key) => ({ key, uri: null }));
    const errors = validateRequestForm(schema(true), filled({ side: null, photos }));
    expect(errors.side).toBe('requirements.form.errors.side');
    expect(errors.photos).toBe('requirements.form.errors.photosMax');
  });

  it('accepts a side-less part on a node without sides, and a machine without a quantity', () => {
    expect(validateRequestForm(schema(false), filled({ side: null }))).toEqual({});
    expect(validateRequestForm(schema(true), filled({ kind: 'machine', side: null, quantity: '', unitId: null }))).toEqual({});
  });

  it('checks the quantity against the unit decimals, the name length and the needed-by window', () => {
    const errors = validateRequestForm(schema(false, 0), filled({ quantity: '2.5', name: 'ab', neededBy: addDays(TODAY, 366) }));
    expect(errors.quantity).toBe('requirements.form.errors.quantityDecimals');
    expect(errors.name).toBe('requirements.form.errors.name');
    expect(errors.neededBy).toBe('requirements.form.errors.neededBy');
    expect(validateRequestForm(schema(false, 0), filled({ neededBy: TODAY }))).toEqual({});
  });

  it('needs at least one condition when narrowed', () => {
    expect(validateRequestForm(schema(false), filled({ conditionIds: [] })).conditionIds).toBe('requirements.form.errors.conditions');
  });
});

const view = (over: Partial<PartRequestBuyerView> = {}): PartRequestBuyerView => ({
  id: 'r1',
  ref: 300001,
  kind: 'part',
  status: 'closed',
  matched: false,
  categoryId: CAT,
  categoryPath: [],
  name: 'Tie rod end',
  partNumber: 'AB123',
  side: 'right',
  fits: [{ brandId: BRAND, brandName: 'Tata', modelId: null, modelName: null, yearFrom: null, yearTo: null }],
  specs: {},
  quantity: '4.000',
  unit: { id: UNIT, key: 'pcs', label: 'pcs' },
  conditionIds: [],
  neededBy: null,
  urgent: false,
  reach: 'radius_200',
  audience: 'verified_only',
  city: 'Rajkot',
  state: 'Gujarat',
  note: 'Call ••••',
  noteFlagged: false,
  photoCount: 0,
  daysLeft: 0,
  expiresAt: '2026-11-30T00:00:00.000Z',
  firstPostedAt: '2026-11-15T00:00:00.000Z',
  createdAt: '2026-11-15T00:00:00.000Z',
  role: 'buyer',
  version: 3,
  photoKeys: [],
  budgetPerUnitPaise: null,
  budgetVisible: false,
  validityDays: 15,
  closeReason: 'other',
  fulfilledDealId: null,
  counts: { replies: 0, matches: 0, newReplies: 0, newMatches: 0 },
  targetedCount: 0,
  fulfilPrompt: null,
  renewableUntil: '2027-02-13T00:00:00.000Z',
  ...over,
});

describe('edit and copy', () => {
  it('sends only what changed, never the masked note it was shown', () => {
    const base = fromBuyerView(view());
    expect(base.quantity).toBe('4');
    const patch = toPartRequestPatch({ ...base, urgent: true, partNumber: '' }, base, 3);
    expect(patch).toEqual({ version: 3, urgent: true, partNumber: null });
  });

  it('copies the identity of a closed request into a new form', () => {
    const p = copyOf(view());
    expect(p).toMatchObject({ source: 'copy', kind: 'part', categoryId: CAT, name: 'Tie rod end', partNumber: 'AB123', side: 'right' });
    expect(valuesFromPrefill(p).quantity).toBe('4');
    expect(valuesFromPrefill(p).note).toBe('');
  });
});

describe('reachChoices', () => {
  it('offers the state only when the business has one', () => {
    expect(reachChoices('Gujarat').map((c) => c.value)).toEqual(['radius_50', 'radius_200', 'state', 'all_india']);
    expect(reachChoices(null).map((c) => c.value)).toEqual(['radius_50', 'radius_200', 'all_india']);
  });
});
