import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  CATEGORY_EDITABLE_STATUSES,
  EDITABLE_LISTING_STATUSES,
  LISTING_DRAFTS_MAX,
  normalizePartName,
  normalizePartNumber,
  partNumberBase,
  sanityFlags,
  type ListingKind,
  type ListingOwnerView,
  type ListingPatch,
  type ListingProblem,
  type ListingStatus,
  type ReviewReason,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import {
  businesses,
  listingFitments,
  listingMachines,
  listingMedia,
  listingRentals,
  listingStatusHistory,
  listings,
  offers,
  partRequestReplies,
  reports,
  stockHolds,
  units,
  users,
} from '../../db/schema.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { onboardingForUser } from '../business/profile.service.js';
import { loadTemplate } from '../catalog/read.service.js';
import { validateSpecs } from '../catalog/validate-specs.js';
import { getSettings } from '../settings.service.js';
import { afterListingStatusWrite } from '../deals/holds.js';
import { applySystemTransition, recordCreated, transitionNotAllowed } from './listing-lifecycle.service.js';
import {
  businessLocation,
  fitmentsDiffer,
  loadNode,
  lockUnit,
  same,
  templateKindOf,
  validateCategory,
  validateCondition,
  validateFitments,
  validateLocation,
  validateMachine,
  validatePartBrand,
  validatePrice,
  validateQuantities,
  validateRental,
  validateUnit,
  type ListingNode,
  type LocationInput,
  type MachineColumns,
  type MachinePatch,
  type RentalColumns,
  type RentalPatch,
  type StoredFitment,
  type UnitRow,
} from './listing-validate.service.js';
import { removePublicMedia } from './listing-media.service.js';
import { hasOpenReport, toOwnerView } from './listing-view.service.js';
import { listingNotFound, lockBusinessThenListing, type ListingRow } from './locks.js';
import { refreshListingSearch } from '../discovery/search-text.js';
import { machineFitTouched, matchRelevantChange } from '../part-requests/listing-hooks.js';
import { applyDraftPrefill, preparePendingReply } from '../part-requests/listing-prefill.js';
import { enqueuePartRequestWork } from '../part-requests/work-queue.js';

// Listing writes (F2 spec §4, §5.1, §5.3, §7.3; plan Task 7): create a draft, PATCH with grandfathering, delete a
// draft. Status is never written here: a back-to-review goes through `listing-lifecycle.service.ts`.

const invalid = (code: string, message: string, details?: Record<string, unknown>) => new ValidationError(message, details, code);

function onboardingIncomplete(): ConflictError {
  return new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
}

// ─── Create ───

/**
 * `POST /listings { kind }` (§5.1, §5.3): a `draft` owned by the user's business. Onboarding must be done
 * (`409 ONBOARDING_INCOMPLETE`); a rental needs GST (`403 RENTAL_NEEDS_GST`); at most 20 drafts (`409 DRAFT_LIMIT`);
 * machine kinds get the first active `is_machine_unit` unit by `sort_order, key` (`409 NO_MACHINE_UNIT`) and a
 * quantity of 1. The location is the business's (source `business`; point = its pin, else its pincode's centroid).
 * The business is locked first, so two creates can't both pass the draft count.
 */
export async function createListing(
  tx: Tx,
  user: UserTokenPayload,
  input: { kind: ListingKind; partRequestId?: string },
): Promise<ListingOwnerView> {
  const [u] = await tx.select({ name: users.name, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!u?.businessId) throw onboardingIncomplete();
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, u.businessId)).for('no key update');
  if (!business) throw onboardingIncomplete();
  if ((await onboardingForUser(tx, u)) !== 'done') throw onboardingIncomplete();
  if (input.kind === 'machine_rental' && !business.verificationLevels.includes('gst')) {
    throw new ForbiddenError('Verify your GST to list machines for rent', 'RENTAL_NEEDS_GST');
  }
  // F8 §9.3 (plan D4): "List a matching part" from a request; checks 1–2 before the draft limit.
  const prep = await preparePendingReply(tx, { userId: user.userId, businessId: business.id }, input.partRequestId, input.kind);

  const [drafts] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.businessId, business.id), eq(listings.status, 'draft')));
  if (drafts!.n >= LISTING_DRAFTS_MAX) {
    throw new ConflictError(`You have ${LISTING_DRAFTS_MAX} drafts; finish or delete one first`, 'DRAFT_LIMIT');
  }

  let unitId: string | null = null;
  if (input.kind !== 'part') {
    const [unit] = await tx
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.isMachineUnit, true), eq(units.isActive, true)))
      .orderBy(asc(units.sortOrder), asc(units.key))
      .limit(1)
      .for('key share');
    if (!unit) throw new ConflictError('No unit is set up for machines yet', 'NO_MACHINE_UNIT');
    unitId = unit.id;
  }

  const [row] = await tx
    .insert(listings)
    .values({
      businessId: business.id,
      createdByUserId: user.userId,
      kind: input.kind,
      side: input.kind === 'part' ? 'not_applicable' : null,
      unitId,
      quantity: input.kind === 'part' ? null : '1',
      ...businessLocation(business),
      ...prep?.listingValues,
    })
    .returning();
  if (input.kind !== 'part') await tx.insert(listingMachines).values({ listingId: row!.id });
  if (input.kind === 'machine_rental') await tx.insert(listingRentals).values({ listingId: row!.id });
  await recordCreated(tx, row!.id, user.userId);
  await applyDraftPrefill(tx, prep, row!);
  // F4 + F5 §5.2 (after the F8 prefill, so the search text sees it): every listing write that changes a search input rebuilds the search columns in its transaction.
  await refreshListingSearch(tx, [row!.id]);
  return toOwnerView(tx, row!, await getSettings(tx));
}

// ─── PATCH ───

export type ListingPatchInput = ListingPatch & { kind?: ListingKind };

const PART_ONLY = ['partNumber', 'partBrandId', 'side', 'unitId', 'minOrderQty', 'fitments'] as const;
const NOT_RENTAL = ['priceModel', 'pricePaise', 'gstMode', 'conditionId', 'conditionNote'] as const;

/** `400 FIELD_NOT_FOR_KIND` (§14) for a field the listing's kind doesn't have. */
function checkFieldsForKind(kind: ListingKind, patch: ListingPatchInput): void {
  const notFor = (field: string) => invalid('FIELD_NOT_FOR_KIND', `A ${kind.replace('_', ' ')} listing has no ${field}`, { field });
  if (kind !== 'part') for (const f of PART_ONLY) if (patch[f] !== undefined) throw notFor(f);
  if (kind === 'part' && patch.machine !== undefined) throw notFor('machine');
  if (kind !== 'machine_rental' && patch.rental !== undefined) throw notFor('rental');
  if (kind === 'machine_rental') {
    for (const f of NOT_RENTAL) if (patch[f] !== undefined) throw notFor(f);
    if (patch.machine?.reasonForSale !== undefined) throw notFor('machine.reasonForSale');
  }
}

const RATE_KEYS = ['rateHourPaise', 'rateDayPaise', 'rateWeekPaise', 'rateMonthPaise'] as const;
/** On view (F6 + F7 §8.3: `reserved` too); a flagged edit sends them back to review. */
const PUBLIC_EDIT_STATUSES: readonly ListingStatus[] = ['live', 'rented', 'reserved'];
/** Editable statuses off view that come back through the gate (§7.3, amendment 5). */
const OFF_VIEW_STATUSES: readonly ListingStatus[] = ['paused', 'expired', 'unavailable', 'sold'];

const MACHINE_DEFAULTS: MachineColumns = {
  brandId: null, brandOther: null, modelId: null, modelOther: null, year: null, hoursRun: null, serialNumber: null,
  underPower: false, inspectionByAppointment: false, reasonForSale: null,
};

const RENTAL_DEFAULTS: RentalColumns = {
  rateHourPaise: null, rateDayPaise: null, rateWeekPaise: null, rateMonthPaise: null, shiftHours: 8, monthDays: 26,
  overtimeRateHourPaise: null, minDuration: null, minDurationPeriod: null, operator: null, operatorRateDayPaise: null,
  fuel: 'client', transport: null, transportChargePaise: null, serviceRadiusKm: null, depositPaise: null,
  availableFrom: null, availabilityNote: null,
};

const sameQuantity = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : Number(a) === Number(b));

/**
 * `PATCH /listings/:id` (§7.3). Locks the business, then the listing. Editable statuses only
 * (`409 LISTING_NOT_EDITABLE`); kind never changes (`400 KIND_IMMUTABLE`); fields of another kind are refused
 * (`400 FIELD_NOT_FOR_KIND`); the category changes only in `draft` / `rejected` (`409 CATEGORY_LOCKED`).
 *
 * - **Draft / rejected:** every sent field is checked (loose: a missing required spec waits for publish).
 * - **Every other status — grandfathering (R42):** only the fields that change are checked against today's rules, so a
 *   catalogue change never blocks an unrelated edit; a changed specs object meets today's template whole; a changed
 *   side suits the node now; fitment rows equal to stored ones pass; nothing required may be removed
 *   (`400 LISTING_INCOMPLETE` with `details.problems`).
 *
 * Every PATCH bumps `version`; a non-draft one sets `refreshed_at` and recomputes `flags` (R16): a `live` / `rented`
 * listing with a flag no moderator accepted, or a side / fitment change while a report is open, goes back to review
 * (`edit_flagged`, `edited_after_report`); a `pending_review` one gains the reasons; the others keep the flag for the
 * go-live gate, and a `paused` / `expired` / `unavailable` / `sold` one also stores `edited_after_report` in its review
 * reasons for the gate (amendment 5).
 *
 * F6 + F7 (§8.3, §22): `reserved` is editable; a quantity below the stock on hold → `409 QUANTITY_BELOW_HELD`; a unit
 * change while the listing has an active hold or a `pending` / `backup` offer → `409 UNIT_LOCKED`. After a quantity or
 * price-model change, or a back-to-review, `afterListingStatusWrite` runs (reserve / unreserve, then reconcile, which
 * closes chains whose kind no longer fits, `listing_changed`).
 */
export async function patchListing(tx: Tx, user: UserTokenPayload, id: string, patch: ListingPatchInput): Promise<ListingOwnerView> {
  if (!user.businessId) throw listingNotFound();
  const { business, listing } = await lockBusinessThenListing(tx, user.businessId, id);
  if (!(EDITABLE_LISTING_STATUSES as readonly ListingStatus[]).includes(listing.status)) {
    throw new ConflictError("This listing can't be edited now", 'LISTING_NOT_EDITABLE');
  }
  if (patch.kind !== undefined && patch.kind !== listing.kind) throw invalid('KIND_IMMUTABLE', "A listing's kind can't change");
  checkFieldsForKind(listing.kind, patch);

  const kind = listing.kind;
  const draft = listing.status === 'draft';
  const loose = draft || listing.status === 'rejected';
  const set: Partial<typeof listings.$inferInsert> = {};

  // Category (and the node every other check reads, locked FOR KEY SHARE before it is read).
  let categoryChanged = false;
  let node: ListingNode | null = null;
  if (patch.categoryId !== undefined && (loose || patch.categoryId !== listing.categoryId)) {
    if (patch.categoryId !== listing.categoryId && !(CATEGORY_EDITABLE_STATUSES as readonly ListingStatus[]).includes(listing.status)) {
      throw new ConflictError("The category can't change once a listing has been reviewed", 'CATEGORY_LOCKED');
    }
    node = await validateCategory(tx, patch.categoryId, kind);
    categoryChanged = patch.categoryId !== listing.categoryId;
    set.categoryId = patch.categoryId;
  }
  const categoryId = patch.categoryId ?? listing.categoryId;
  const currentNode = async (): Promise<ListingNode | null> => {
    if (!node && categoryId) node = await loadNode(tx, categoryId, { lock: true });
    return node;
  };

  // Specs: a new category drops the keys its template doesn't have; sent specs are checked against the node.
  let specs = listing.specs;
  if (categoryChanged) {
    const template = await loadTemplate(tx, categoryId!, templateKindOf(kind), { includeRetired: true, allowInactive: true });
    const keys = new Set(template.fields.map((f) => f.key));
    specs = Object.fromEntries(Object.entries(specs).filter(([k]) => keys.has(k)));
  }
  if (patch.specs !== undefined && (loose || !same(patch.specs, listing.specs))) {
    if (!categoryId) throw invalid('SPECS_INVALID', 'Pick a category first');
    await currentNode();
    const result = await validateSpecs(tx, categoryId, templateKindOf(kind), patch.specs, listing.specs, { allowInactive: !categoryChanged });
    if (!result.ok) {
      const errors = Object.fromEntries(Object.entries(result.errors).filter(([, code]) => !loose || code !== 'required'));
      if (Object.keys(errors).length > 0) throw invalid('SPECS_INVALID', 'Some specifications need fixing', errors);
    }
    specs = patch.specs;
  }
  if (!same(specs, listing.specs)) set.specs = specs;

  // Side (parts): forced to "No side" on a node without sides; a changed side suits the node now.
  let side = listing.side;
  if (kind === 'part') {
    if (categoryChanged && !node!.effectiveHasSides) side = 'not_applicable';
    if (patch.side !== undefined && (loose || patch.side !== listing.side)) {
      const hasSides = (await currentNode())?.effectiveHasSides ?? false;
      if (!hasSides && patch.side !== 'not_applicable') throw invalid('SIDE_NOT_ALLOWED', "This part group has no left or right side");
      if (hasSides && !loose && patch.side === 'not_applicable') throw invalid('SIDE_REQUIRED', 'Pick left, right or pair');
      side = patch.side;
    }
    if (side !== listing.side) set.side = side;
  }
  const sideChanged = side !== listing.side;

  // Title, description, part number and the norms.
  if (patch.title !== undefined) {
    set.title = patch.title;
    set.titleNorm = normalizePartName(patch.title);
  }
  if (patch.description !== undefined) set.description = patch.description || null;
  const partNumber = patch.partNumber !== undefined ? patch.partNumber || null : listing.partNumber;
  if (patch.partNumber !== undefined || sideChanged) {
    const norm = partNumber ? normalizePartNumber(partNumber) || null : null;
    set.partNumber = partNumber;
    set.partNumberNorm = norm;
    set.partNumberBase = norm ? partNumberBase(norm, side) : null;
  }

  // Part brand, unit, quantities, condition.
  if (patch.partBrandId !== undefined) {
    if (patch.partBrandId !== null && (loose || patch.partBrandId !== listing.partBrandId)) await validatePartBrand(tx, patch.partBrandId);
    set.partBrandId = patch.partBrandId;
  }
  const unitId = patch.unitId ?? listing.unitId;
  let unit: UnitRow | null = null;
  const unitChanged = patch.unitId !== undefined && (loose || patch.unitId !== listing.unitId);
  if (unitChanged) {
    unit = await validateUnit(tx, patch.unitId!);
    set.unitId = patch.unitId;
  }
  const quantity = patch.quantity ?? listing.quantity;
  const minOrder = patch.minOrderQty !== undefined ? patch.minOrderQty : listing.minOrderQty;
  const quantityChecked = patch.quantity !== undefined && (loose || !sameQuantity(patch.quantity, listing.quantity));
  const minOrderChecked = patch.minOrderQty !== undefined && (loose || !sameQuantity(patch.minOrderQty, listing.minOrderQty));
  if (unitChanged || quantityChecked || minOrderChecked) {
    if (!unit && unitId) unit = await lockUnit(tx, unitId);
    validateQuantities(kind, unit, quantity, minOrder);
  }
  // F6 + F7 §8.3: stock held in deals can't be edited away, and a unit can't change under open deals or offers.
  if (patch.quantity !== undefined && Number(patch.quantity) < Number(listing.heldQuantity)) {
    throw new ConflictError('Part of this stock is on hold in open deals', 'QUANTITY_BELOW_HELD', { heldQuantity: listing.heldQuantity });
  }
  if (patch.unitId !== undefined && patch.unitId !== listing.unitId && (await unitLocked(tx, listing.id))) {
    throw new ConflictError("The unit can't change while deals or offers are open on this listing", 'UNIT_LOCKED');
  }
  if (patch.quantity !== undefined) set.quantity = patch.quantity;
  if (patch.minOrderQty !== undefined) set.minOrderQty = patch.minOrderQty;
  if (patch.conditionId !== undefined) {
    if (loose || patch.conditionId !== listing.conditionId) await validateCondition(tx, patch.conditionId);
    set.conditionId = patch.conditionId;
  }
  if (patch.conditionNote !== undefined) set.conditionNote = patch.conditionNote || null;

  // Price (parts, machines for sale), delivery, location.
  const price = validatePrice(listing, { priceModel: patch.priceModel, pricePaise: patch.pricePaise, gstMode: patch.gstMode });
  if (patch.priceModel !== undefined || patch.pricePaise !== undefined || patch.gstMode !== undefined) Object.assign(set, price);
  const delivery = patch.delivery !== undefined ? [...new Set(patch.delivery)] : listing.delivery;
  if (patch.delivery !== undefined) set.delivery = delivery;
  if (patch.location !== undefined) {
    Object.assign(set, await validateLocation(tx, patch.location as LocationInput, { business, currentAreaId: listing.industrialAreaId }));
  }

  // Fitments (parts): rows equal to stored ones are grandfathered on a non-draft edit.
  const storedFitments: StoredFitment[] =
    kind === 'part'
      ? await tx
          .select({
            brandId: listingFitments.brandId, modelId: listingFitments.modelId, modelOther: listingFitments.modelOther,
            yearFrom: listingFitments.yearFrom, yearTo: listingFitments.yearTo, note: listingFitments.note, source: listingFitments.source,
          })
          .from(listingFitments)
          .where(eq(listingFitments.listingId, listing.id))
          .orderBy(asc(listingFitments.sortOrder))
      : [];
  let fitments: StoredFitment[] | null = null;
  let fitmentsChanged = false;
  if (patch.fitments !== undefined) {
    const sent = patch.fitments.map((f) => ({ ...f, modelId: f.modelId ?? null, modelOther: f.modelOther ?? null }));
    fitmentsChanged = fitmentsDiffer(sent, storedFitments);
    if (loose || fitmentsChanged) fitments = await validateFitments(tx, sent, storedFitments, { checkAll: loose });
  }

  // Machine and rental rows.
  let machine: MachineColumns | null = null;
  let storedMachine: MachineColumns | null = null;
  if (kind !== 'part') {
    const [m] = await tx.select().from(listingMachines).where(eq(listingMachines.listingId, listing.id));
    if (m) {
      const { listingId: _id, ...columns } = m;
      storedMachine = columns;
    }
    if (patch.machine !== undefined || categoryChanged) {
      machine = await validateMachine(tx, storedMachine ?? MACHINE_DEFAULTS, (patch.machine ?? {}) as MachinePatch, {
        machineTypeId: categoryId,
        categoryChanged,
        loose,
      });
    }
  }
  let rental: RentalColumns | null = null;
  let storedRental: RentalColumns | null = null;
  if (kind === 'machine_rental') {
    const [r] = await tx.select().from(listingRentals).where(eq(listingRentals.listingId, listing.id));
    if (r) {
      const { listingId: _id, ...columns } = r;
      storedRental = columns;
    }
    if (patch.rental !== undefined) rental = validateRental(storedRental ?? RENTAL_DEFAULTS, patch.rental as RentalPatch);
  }

  // Nothing required may be removed from a reviewed listing (§7.3).
  if (!loose) {
    const problems: ListingProblem[] = [];
    if (kind !== 'machine_rental' && (patch.priceModel !== undefined || patch.pricePaise !== undefined || patch.gstMode !== undefined)) {
      if (!price.priceModel) problems.push({ field: 'priceModel', code: 'required' });
      else if (price.priceModel !== 'on_request') {
        if (price.pricePaise == null) problems.push({ field: 'pricePaise', code: 'PRICE_REQUIRED' });
        // GST mode is required unless Price on request (§4.6).
        if (price.gstMode == null) problems.push({ field: 'gstMode', code: 'required' });
      }
    }
    if (rental && RATE_KEYS.some((k) => patch.rental?.[k] !== undefined) && RATE_KEYS.every((k) => rental![k] == null)) {
      problems.push({ field: 'rental.rates', code: 'RATE_REQUIRED' });
    }
    if (patch.delivery !== undefined && delivery.length === 0) problems.push({ field: 'delivery', code: 'required' });
    if (machine && storedMachine && (storedMachine.brandId || storedMachine.brandOther) && !machine.brandId && !machine.brandOther) {
      problems.push({ field: 'machine.brandId', code: 'required' });
    }
    if (problems.length > 0) throw invalid('LISTING_INCOMPLETE', 'Something this listing needs would be removed', { problems });
  }

  // Flags on edit (R16).
  const reasons: ReviewReason[] = [];
  if (!draft) {
    if (!unit && unitId) unit = await lockUnit(tx, unitId);
    const rates = rental ?? storedRental;
    const flags = sanityFlags({
      kind,
      priceModel: price.priceModel,
      pricePaise: price.pricePaise,
      quantity,
      unitIsMachineUnit: unit?.isMachineUnit ?? false,
      rental: rates,
    });
    set.flags = flags;
    // Public: any flag no moderator accepted (§7.3). In review: only a flag this edit raised, so the reason isn't
    // repeated for one the moderator already sees.
    const unaccepted = flags.filter((f) => !listing.acceptedFlags.includes(f));
    const isPublic = PUBLIC_EDIT_STATUSES.includes(listing.status);
    if (unaccepted.some((f) => isPublic || !listing.flags.includes(f))) reasons.push('edit_flagged');
    if ((sideChanged || fitmentsChanged) && (await hasOpenReport(tx, listing.id))) reasons.push('edited_after_report');
    if (listing.status === 'pending_review' && reasons.length > 0) set.reviewReasons = [...new Set([...listing.reviewReasons, ...reasons])];
    // Amendment 5: off view, the edit after a report is remembered (as a stored flag is), and the go-live gate sends
    // resume, renew, relist and end of rental to review while it is set; approval clears it.
    if (OFF_VIEW_STATUSES.includes(listing.status) && reasons.includes('edited_after_report')) {
      set.reviewReasons = [...new Set([...listing.reviewReasons, 'edited_after_report' as const])];
    }
  }

  // An edit that changes nothing writes nothing: no version bump (a repeated autosave must not fail a moderator's open
  // decision with LISTING_CHANGED), no refresh, no back-to-review.
  const childrenChanged =
    (machine !== null && (storedMachine === null || !same(machine, storedMachine))) ||
    (rental !== null && (storedRental === null || !same(rental, storedRental))) ||
    (fitments !== null && fitmentsDiffer(fitments, storedFitments));
  if (!childrenChanged && !(await rowChanges(tx, listing, set))) return toOwnerView(tx, listing, await getSettings(tx));

  const [updated] = await tx
    .update(listings)
    .set({
      ...set,
      version: sql`${listings.version} + 1`,
      updatedAt: sql`now()`,
      ...(draft ? {} : { refreshedAt: sql`now()` }),
    })
    .where(eq(listings.id, listing.id))
    .returning();

  if (machine) {
    if (storedMachine) await tx.update(listingMachines).set(machine).where(eq(listingMachines.listingId, listing.id));
    else await tx.insert(listingMachines).values({ listingId: listing.id, ...machine });
  }
  if (rental) {
    if (storedRental) await tx.update(listingRentals).set(rental).where(eq(listingRentals.listingId, listing.id));
    else await tx.insert(listingRentals).values({ listingId: listing.id, ...rental });
  }
  if (fitments) {
    await tx.delete(listingFitments).where(eq(listingFitments.listingId, listing.id));
    if (fitments.length > 0) {
      await tx.insert(listingFitments).values(fitments.map((f, i) => ({ listingId: listing.id, ...f, sortOrder: i })));
    }
  }

  // F4 + F5 §5.2: title, part number, brand, category, specs, fitments, machine details, condition or location changed.
  await refreshListingSearch(tx, [listing.id]);

  let row: ListingRow = updated!;
  let statusWritten = false;
  // F6 + F7 §8.3: a reserved listing goes back to review like a live one (`return_status = 'live'`).
  if (PUBLIC_EDIT_STATUSES.includes(listing.status) && reasons.length > 0) {
    row = await applySystemTransition(tx, row, 'back_to_review', { reviewReasons: reasons });
    statusWritten = true;
  }
  const quantityChanged = patch.quantity !== undefined && !sameQuantity(patch.quantity, listing.quantity);
  const priceModelChanged = set.priceModel !== undefined && set.priceModel !== listing.priceModel;
  if (statusWritten || quantityChanged || priceModelChanged) row = await afterListingStatusWrite(tx, listing.id);
  // F8 §8.1: a live listing's match-relevant edit is queued (a reserved → live move above already queued it via
  // `writeStatus`; the unclaimed-only unique collapses the two).
  const fitmentsTouched = (fitments !== null && fitmentsChanged) || machineFitTouched(storedMachine, machine);
  if (row.status === 'live' && row.kind !== 'machine_rental' && matchRelevantChange(listing, row, fitmentsTouched)) {
    await enqueuePartRequestWork(tx, 'listing_changed', row.id);
  }
  return toOwnerView(tx, row, await getSettings(tx));
}

/** Whether the listing has an active stock hold or a `pending` / `backup` offer (§8.3 `UNIT_LOCKED`). */
async function unitLocked(tx: Tx, listingId: string): Promise<boolean> {
  const [hold] = await tx
    .select({ id: stockHolds.id })
    .from(stockHolds)
    .where(and(eq(stockHolds.listingId, listingId), eq(stockHolds.status, 'active')))
    .limit(1);
  if (hold) return true;
  const [offer] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.listingId, listingId), inArray(offers.status, ['pending', 'backup'])))
    .limit(1);
  return !!offer;
}

/** Whether `set` changes any column of the stored row (quantities compared as numbers, the point in PostGIS). */
async function rowChanges(tx: Tx, row: ListingRow, set: Partial<typeof listings.$inferInsert>): Promise<boolean> {
  for (const [key, value] of Object.entries(set)) {
    if (key === 'point') continue;
    const stored = row[key as keyof ListingRow];
    if (key === 'quantity' || key === 'minOrderQty') {
      if (!sameQuantity((value as string | null) ?? null, (stored as string | null) ?? null)) return true;
    } else if (!same(value, stored)) {
      return true;
    }
  }
  if (set.point === undefined) return false;
  const { rows } = await tx.execute<{ same: boolean }>(
    sql`SELECT ST_AsBinary(point) IS NOT DISTINCT FROM ST_AsBinary(${set.point}) AS same FROM listings WHERE id = ${row.id}`,
  );
  return rows[0]?.same !== true;
}

// ─── Delete a draft ───

/**
 * `DELETE /listings/:id` (§5.3, R27): drafts only (`409 LISTING_TRANSITION_NOT_ALLOWED`, action `delete`). The row,
 * its children and its media rows go in one transaction; returns the media keys, which the caller deletes (and purges)
 * after commit, best-effort (Task 13).
 */
export async function deleteDraft(tx: Tx, user: UserTokenPayload, id: string): Promise<{ mediaKeys: string[] }> {
  if (!user.businessId) throw listingNotFound();
  const { listing } = await lockBusinessThenListing(tx, user.businessId, id);
  if (listing.status !== 'draft') throw transitionNotAllowed(listing.status, 'delete');
  const media = await tx.select({ key: listingMedia.key, thumbKey: listingMedia.thumbKey }).from(listingMedia).where(eq(listingMedia.listingId, id));
  // F8 §9.3: a draft made from a request takes its pending reply with it, silently.
  await tx.delete(partRequestReplies).where(eq(partRequestReplies.listingId, id));
  await tx.delete(reports).where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, id)));
  await tx.delete(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
  await tx.delete(listingMedia).where(eq(listingMedia.listingId, id));
  await tx.delete(listingFitments).where(eq(listingFitments.listingId, id));
  await tx.delete(listingRentals).where(eq(listingRentals.listingId, id));
  await tx.delete(listingMachines).where(eq(listingMachines.listingId, id));
  await tx.delete(listings).where(eq(listings.id, id));
  return { mediaKeys: media.flatMap((m) => (m.thumbKey ? [m.key, m.thumbKey] : [m.key])) };
}

/**
 * The route's draft delete: `deleteDraft` in its own transaction, then, after commit, the media objects deleted from
 * the public bucket and their CDN URLs purged (§6.1, R45). The clean-up is best-effort: skipped when media storage
 * isn't configured, each failure logged, never thrown (the rows are gone already).
 */
export async function deleteDraftWithMedia(
  db: Db,
  user: UserTokenPayload,
  id: string,
  log?: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const { mediaKeys } = await db.transaction((tx) => deleteDraft(tx, user, id));
  await removePublicMedia(mediaKeys, log);
}
