import type { BusinessProfile, ListingKind, ListingOwnerView, ListingProblem } from '@mpm/shared-types';
import type { SellStep } from './sell-steps';

// The sell wizard's steps (F2 spec §5.2, §5.3; plan Task 21). Pure: the Sell route host (`screens/sell/sell-step.tsx`)
// reads the step list, the Steps bar and Back / Next from here, and Preview maps a `LISTING_INCOMPLETE` problem to the
// step that fixes it.

export type EditStep = Exclude<SellStep, 'preview'>;

/**
 * The editing steps of a kind, in order (§5.2's table), without `preview`: the Steps bar shows "Step n of
 * `wizardSteps(...).length`", and Next on the last step opens `preview`. `side` only when the part group has sides.
 * Rentals have no quantity step: their machine count is asked on the machine step (`stepFields('machine', ...)`).
 */
export function wizardSteps(kind: ListingKind, hasSides: boolean): EditStep[] {
  if (kind === 'part') {
    return ['category', 'part_details', 'quantity', 'fit', ...(hasSides ? (['side'] as const) : []), 'media', 'price', 'location'];
  }
  if (kind === 'machine') return ['category', 'machine', 'quantity', 'media', 'price', 'location'];
  return ['category', 'machine', 'rates', 'media', 'location'];
}

/** The step after `step` (`preview` after the last editing step); null after `preview` or for a step not in the list. */
export function nextStep(kind: ListingKind, hasSides: boolean, step: SellStep): SellStep | null {
  if (step === 'preview') return null;
  const steps = wizardSteps(kind, hasSides);
  const i = steps.indexOf(step);
  if (i < 0) return null;
  return steps[i + 1] ?? 'preview';
}

/** The step before `step` (the last editing step before `preview`); null on the first step. */
export function prevStep(kind: ListingKind, hasSides: boolean, step: SellStep): SellStep | null {
  const steps = wizardSteps(kind, hasSides);
  if (step === 'preview') return steps[steps.length - 1] ?? null;
  const i = steps.indexOf(step);
  return i > 0 ? steps[i - 1]! : null;
}

/** 1-based position for the Steps bar ("Step 3 of 8"); `preview` counts as done (total of total). */
export function stepPosition(kind: ListingKind, hasSides: boolean, step: SellStep): { current: number; total: number } {
  const steps = wizardSteps(kind, hasSides);
  const i = step === 'preview' ? steps.length - 1 : steps.indexOf(step);
  return { current: Math.max(0, i) + 1, total: steps.length };
}

/**
 * The fields a step edits: the `ListingPatch` keys it sends on Next, and the first segment of the problem fields it
 * fixes (`specs.width` → `specs`, `rental.rates` → `rental`, `machine.brandId` → `machine`, `photos`).
 */
export function stepFields(step: SellStep, kind: ListingKind = 'part'): string[] {
  switch (step) {
    case 'category': return ['categoryId', 'category'];
    case 'part_details': return ['title', 'description', 'partNumber', 'specs'];
    case 'machine':
      return ['title', 'description', 'specs', 'machine', ...(kind === 'machine_rental' ? ['quantity'] : [])];
    case 'quantity': return ['quantity', 'unitId', 'conditionId', 'conditionNote'];
    case 'rates': return ['rental'];
    case 'fit': return ['partBrandId', 'fitments'];
    case 'side': return ['side'];
    case 'media': return ['photos', 'videos', 'media'];
    case 'price': return ['priceModel', 'pricePaise', 'gstMode', 'minOrderQty'];
    case 'location': return ['location', 'delivery'];
    case 'preview': return [];
  }
}

/**
 * The step that edits a problem's field (Preview's `LISTING_INCOMPLETE`, My listings' `needsAttention`):
 * `specs.width` → `part_details` (parts) or `machine`, `photos` → `media`, `rental.rates` → `rates`. Null for a field
 * no step of the kind edits.
 */
export function stepForProblem(field: string, kind: ListingKind = 'part'): EditStep | null {
  const head = field.split('.')[0]!;
  for (const step of wizardSteps(kind, true)) {
    if (stepFields(step, kind).includes(head)) return step;
  }
  return null;
}

const hasText = (s: string | null | undefined): boolean => !!s && s.trim().length > 0;

/** Whether a step's required fields are filled on the listing (optional steps — fit — always are). */
function stepDone(step: EditStep, l: ListingOwnerView): boolean {
  switch (step) {
    case 'category': return l.categoryId != null;
    case 'part_details': return hasText(l.title);
    case 'machine': return hasText(l.title) && (l.machine?.brandId != null || hasText(l.machine?.brandOther));
    case 'quantity': return l.quantity != null && (l.kind !== 'part' || l.unitId != null) && l.conditionId != null;
    case 'rates': {
      const r = l.rental;
      return !!r && [r.rateHourPaise, r.rateDayPaise, r.rateWeekPaise, r.rateMonthPaise].some((v) => v != null);
    }
    case 'fit': return true;
    case 'side': return l.side === 'left' || l.side === 'right' || l.side === 'pair';
    case 'media': return l.media.some((m) => m.type === 'photo');
    case 'price':
      return l.priceModel === 'on_request' || (l.priceModel != null && l.pricePaise != null && l.gstMode != null);
    case 'location':
      return l.delivery.length > 0 && (l.location.source === 'business' || (hasText(l.location.pincode) && hasText(l.location.city)));
  }
}

/**
 * Where "Continue" opens a draft (§5.3): the first step with a required field missing, or one of the listing's
 * `needsAttention` problems points at; `preview` when nothing is missing.
 */
export function firstIncompleteStep(listing: ListingOwnerView, hasSides: boolean): SellStep {
  const steps = wizardSteps(listing.kind, hasSides);
  const flagged = new Set(
    (listing.needsAttention as ListingProblem[]).map((p) => stepForProblem(p.field, listing.kind)).filter((s) => s !== null),
  );
  return steps.find((s) => flagged.has(s) || !stepDone(s, listing)) ?? 'preview';
}

/** The machine title prefill (§4.2, R28): "type, make model" — `Rapier loom, Picanol OptiMax`; parts left out when missing. */
export function machineTitle(typeName: string | null | undefined, makeName?: string | null, modelName?: string | null): string {
  const make = [makeName, modelName].map((s) => s?.trim()).filter(Boolean).join(' ');
  return [typeName?.trim(), make].filter(Boolean).join(', ');
}

/** Machines for rent need GST verification (decision 7, §5.1): the Post tab's rental card is enabled only then. */
export function canListRental(business: Pick<BusinessProfile, 'verificationLevels'> | null | undefined): boolean {
  return !!business?.verificationLevels?.includes('gst');
}
