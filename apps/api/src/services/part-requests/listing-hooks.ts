import type { ListingRow } from '../listings/locks.js';

// What in a listing edit is worth re-matching against requests (spec §8.1, §20; plan C0-4a). A `live` listing whose
// edit changes one of these is queued (`listing_changed`); the description, price, photos, delivery and the like aren't.

/** The machine row's fit columns (`listing_machines`): brand, model, year. */
export interface MachineFit {
  brandId: string | null;
  brandOther: string | null;
  modelId: string | null;
  modelOther: string | null;
  year: number | null;
}

/** Whether a machine listing's brand / model / year changed (half of `fitmentsTouched`). */
export function machineFitTouched(before: MachineFit | null, after: MachineFit | null): boolean {
  if (after === null) return false;
  if (before === null) return true;
  return (
    before.brandId !== after.brandId ||
    before.brandOther !== after.brandOther ||
    before.modelId !== after.modelId ||
    before.modelOther !== after.modelOther ||
    before.year !== after.year
  );
}

const available = (r: Pick<ListingRow, 'quantity' | 'heldQuantity'>) => Number(r.quantity ?? 0) - Number(r.heldQuantity ?? 0);

/**
 * True when the edit changes what matching reads: title, `part_number_norm`, side, `category_id`, `condition_id`, the
 * listing's own location (`point` / `search_point`, pincode, state), its fitments or machine brand / model / year
 * (`fitmentsTouched`, both child tables), or available quantity rising from 0.
 */
export function matchRelevantChange(before: ListingRow, after: ListingRow, fitmentsTouched: boolean): boolean {
  if (fitmentsTouched) return true;
  if (
    before.title !== after.title ||
    before.partNumberNorm !== after.partNumberNorm ||
    before.side !== after.side ||
    before.categoryId !== after.categoryId ||
    before.conditionId !== after.conditionId
  ) {
    return true;
  }
  if (
    before.point !== after.point ||
    before.searchPoint !== after.searchPoint ||
    before.pincode !== after.pincode ||
    before.state !== after.state
  ) {
    return true;
  }
  return available(before) <= 0 && available(after) > 0;
}
