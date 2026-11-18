import { describe, expect, it } from 'vitest';
import {
  canListRental, firstIncompleteStep, machineTitle, nextStep, prevStep, stepFields, stepForProblem, stepPosition,
  wizardSteps,
} from './sell-wizard';
import { ownerFixture } from './listing-fixtures.test-helper';

describe('wizardSteps', () => {
  it('a part without sides has 7 steps and no side step', () => {
    const steps = wizardSteps('part', false);
    expect(steps).toHaveLength(7);
    expect(steps).not.toContain('side');
    expect(steps).toEqual(['category', 'part_details', 'quantity', 'fit', 'media', 'price', 'location']);
  });
  it('a part with sides has 8 steps, side after fit', () => {
    expect(wizardSteps('part', true)).toEqual(['category', 'part_details', 'quantity', 'fit', 'side', 'media', 'price', 'location']);
  });
  it('a machine for sale has 6 steps', () => {
    expect(wizardSteps('machine', true)).toEqual(['category', 'machine', 'quantity', 'media', 'price', 'location']);
  });
  it('a rental has rates and no price (nor quantity)', () => {
    const steps = wizardSteps('machine_rental', false);
    expect(steps).toContain('rates');
    expect(steps).not.toContain('price');
    expect(steps).not.toContain('quantity');
    expect(steps).toHaveLength(5);
  });
});

describe('nextStep / prevStep / stepPosition', () => {
  it('walks to preview after the last step and back', () => {
    expect(nextStep('part', false, 'category')).toBe('part_details');
    expect(nextStep('part', false, 'fit')).toBe('media');
    expect(nextStep('part', true, 'fit')).toBe('side');
    expect(nextStep('part', false, 'location')).toBe('preview');
    expect(nextStep('part', false, 'preview')).toBeNull();
    expect(prevStep('part', false, 'category')).toBeNull();
    expect(prevStep('part', false, 'preview')).toBe('location');
    expect(prevStep('machine_rental', false, 'media')).toBe('rates');
  });
  it('a step the kind does not have has no neighbours', () => {
    expect(nextStep('machine', false, 'side')).toBeNull();
    expect(prevStep('part', false, 'rates')).toBeNull();
  });
  it('positions for the Steps bar', () => {
    expect(stepPosition('part', true, 'side')).toEqual({ current: 5, total: 8 });
    expect(stepPosition('machine', false, 'preview')).toEqual({ current: 6, total: 6 });
  });
});

describe('stepFields / stepForProblem', () => {
  it('maps problem fields to the step that edits them', () => {
    expect(stepForProblem('specs.width')).toBe('part_details');
    expect(stepForProblem('specs.width', 'machine')).toBe('machine');
    expect(stepForProblem('photos')).toBe('media');
    expect(stepForProblem('rental.rates', 'machine_rental')).toBe('rates');
    expect(stepForProblem('machine.brandId', 'machine')).toBe('machine');
    expect(stepForProblem('side')).toBe('side');
    expect(stepForProblem('pricePaise')).toBe('price');
    expect(stepForProblem('gstMode', 'machine')).toBe('price');
    expect(stepForProblem('categoryId')).toBe('category');
    expect(stepForProblem('location')).toBe('location');
    expect(stepForProblem('delivery')).toBe('location');
    expect(stepForProblem('conditionId')).toBe('quantity');
    expect(stepForProblem('unitId')).toBe('quantity');
  });
  it('rentals ask their machine count on the machine step', () => {
    expect(stepForProblem('quantity', 'machine_rental')).toBe('machine');
    expect(stepForProblem('quantity', 'machine')).toBe('quantity');
  });
  it('null for a field no step of the kind edits', () => {
    expect(stepForProblem('rental.rates', 'part')).toBeNull();
    expect(stepForProblem('nonsense')).toBeNull();
    expect(stepFields('preview')).toEqual([]);
  });
});

describe('firstIncompleteStep', () => {
  it('a draft with category and details → the quantity step', () => {
    const l = ownerFixture({ categoryId: 'c1', title: 'Temple roller' });
    expect(firstIncompleteStep(l, false)).toBe('quantity');
  });
  it('a new draft → category', () => {
    expect(firstIncompleteStep(ownerFixture(), true)).toBe('category');
  });
  it('a problem the server flags wins over the field check', () => {
    const l = ownerFixture({ categoryId: 'c1', title: 'Roller', needsAttention: [{ field: 'specs.width', code: 'required' }] });
    expect(firstIncompleteStep(l, false)).toBe('part_details');
  });
  it('the side step needs left, right or pair; then media, price, location', () => {
    const base = {
      categoryId: 'c1', title: 'Roller', quantity: '2', unitId: 'u1', conditionId: 'k1',
    };
    expect(firstIncompleteStep(ownerFixture({ ...base, side: 'not_applicable' }), true)).toBe('side');
    const sided = { ...base, side: 'left' as const };
    expect(firstIncompleteStep(ownerFixture(sided), true)).toBe('media');
    const photo = { id: 'm1', type: 'photo' as const, url: null, thumbUrl: null, contentType: 'image/jpeg', sizeBytes: 1, durationMs: null, sortOrder: 0 };
    const withPhoto = { ...sided, media: [photo] };
    expect(firstIncompleteStep(ownerFixture(withPhoto), true)).toBe('price');
    const priced = { ...withPhoto, priceModel: 'on_request' as const };
    expect(firstIncompleteStep(ownerFixture(priced), true)).toBe('location');
    expect(firstIncompleteStep(ownerFixture({ ...priced, delivery: ['pickup'] }), true)).toBe('preview');
  });
  it('a machine needs a make; a rental needs a rate', () => {
    const machine = ownerFixture({ kind: 'machine', categoryId: 'c1', title: 'Loom', machine: null });
    expect(firstIncompleteStep(machine, false)).toBe('machine');
    const rental = ownerFixture({
      kind: 'machine_rental', categoryId: 'c1', title: 'Loom',
      machine: {
        brandId: null, brandName: null, brandOther: 'Local', modelId: null, modelName: null, modelOther: null, year: null,
        hoursRun: null, underPower: false, inspectionByAppointment: false, reasonForSale: null,
      },
    });
    expect(firstIncompleteStep(rental, false)).toBe('rates');
  });
});

describe('machineTitle', () => {
  it('type, make model', () => {
    expect(machineTitle('Rapier loom', 'Picanol', 'OptiMax')).toBe('Rapier loom, Picanol OptiMax');
  });
  it('leaves out what is missing', () => {
    expect(machineTitle('Rapier loom', 'Picanol', null)).toBe('Rapier loom, Picanol');
    expect(machineTitle('Rapier loom', null, null)).toBe('Rapier loom');
    expect(machineTitle(null, 'Picanol', 'OptiMax')).toBe('Picanol OptiMax');
  });
});

describe('canListRental', () => {
  it('true only with gst verification', () => {
    expect(canListRental({ verificationLevels: ['phone', 'gst'] })).toBe(true);
    expect(canListRental({ verificationLevels: ['phone'] })).toBe(false);
    expect(canListRental({ verificationLevels: ['phone', 'business'] })).toBe(false);
    expect(canListRental(null)).toBe(false);
  });
});
