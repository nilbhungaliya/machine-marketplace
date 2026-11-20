import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  BUSINESS_ACTIVITIES,
  type BusinessActivity,
  type BusinessProfile,
  type EmployeeRange,
  type OnboardingStep,
  type VerificationLevel,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, categories, industrialAreas, listings, users } from '../../db/schema.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { areasForPincode } from '../locations/industrial-areas.service.js';
import { pincodeDistrict } from '../locations/pincode.service.js';
import { syncBusinessListings } from '../listings/listing-validate.service.js';
import { enqueueListingsChanged } from '../part-requests/work-queue.js';

// The business profile and location (F1 spec §4.1, §4.2, §10). Ruling R1: a new user has no business row until their
// first PATCH /businesses/me, which creates it; that is the only way a business is created (the old onboarding route
// PATCH /users/me is gone), so every business starts with a name, a business name and at least one activity.

export type BusinessRow = typeof businesses.$inferSelect;

type OnboardingFields = Pick<
  BusinessRow,
  'tradeName' | 'activities' | 'categories' | 'pincode' | 'city' | 'state' | 'industrialAreaId' | 'industrialAreaOther'
>;

const filled = (s: string | null | undefined): boolean => !!s && s.trim() !== '';

function profileDone(b: OnboardingFields, userName: string | null): boolean {
  return filled(userName) && filled(b.tradeName) && b.activities.length > 0 && b.categories.length > 0;
}

function locationDone(b: OnboardingFields): boolean {
  return filled(b.pincode) && filled(b.city) && filled(b.state) && (!!b.industrialAreaId || filled(b.industrialAreaOther));
}

/**
 * Where onboarding resumes: `'profile'` unless the person's name, the business name, ≥1 activity and ≥1 machine
 * category are set; else `'location'` unless pincode, city, state and an industrial area (listed or Other) are set;
 * else `'done'`. Pass the business with its categories already filtered (`activeCategoryIds`).
 */
export function onboardingStep(b: OnboardingFields, userName: string | null): OnboardingStep {
  if (!profileDone(b, userName)) return 'profile';
  return locationDone(b) ? 'done' : 'location';
}

function noBusiness(): AppError {
  return new AppError("You haven't set up your business yet", 404, 'NO_BUSINESS');
}

/** The ids that are active machine categories (level-1 catalogue nodes), in the order given. */
async function activeCategoryIds(conn: Db | Tx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await conn
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.id, ids), eq(categories.level, 'machine_category'), eq(categories.isActive, true)));
  const active = new Set(rows.map((r) => r.id));
  return ids.filter((id) => active.has(id));
}

/**
 * The active `gst` verification, if any, with the trade name it was granted with: the officer-approved details when
 * there are any (an officer who cleared the trade name wins over the lookup's), else the lookup the proof was attached
 * to. `null` when GST isn't verified.
 */
async function activeGst(conn: Db | Tx, businessId: string): Promise<{ tradeName: string | null } | null> {
  const { rows } = await conn.execute<{ trade_name: string | null }>(sql`
    SELECT CASE WHEN p.approved_details IS NOT NULL THEN p.approved_details->>'tradeName' ELSE c.details->>'tradeName' END AS trade_name
    FROM business_verifications v
    LEFT JOIN gst_representative_proofs p ON p.id = v.verified_by_proof_id
    LEFT JOIN gst_checks c ON c.id = p.check_id
    WHERE v.business_id = ${businessId} AND v.level = 'gst' AND v.status = 'active'
    LIMIT 1
  `);
  const row = rows[0];
  return row ? { tradeName: filled(row.trade_name) ? row.trade_name!.trim() : null } : null;
}

/**
 * The name buyers see (`BusinessProfile.displayName`): GST's trade name, else the legal name, while a `gst`
 * verification is active; otherwise `trade_name`.
 */
export async function businessDisplayName(
  conn: Db | Tx,
  b: Pick<BusinessRow, 'id' | 'tradeName' | 'legalName'>,
): Promise<string> {
  const gst = await activeGst(conn, b.id);
  return gst ? (gst.tradeName ?? b.legalName ?? b.tradeName) : b.tradeName;
}

/** The onboarding step for a signed-in user: `'profile'` while they have no business (R1). */
export async function onboardingForUser(conn: Db | Tx, user: { name: string | null; businessId: string | null }): Promise<OnboardingStep> {
  if (!user.businessId) return 'profile';
  const [b] = await conn.select().from(businesses).where(eq(businesses.id, user.businessId));
  if (!b) return 'profile';
  return onboardingStep({ ...b, categories: await activeCategoryIds(conn, b.categories) }, user.name);
}

/**
 * The user row. `lock` takes `FOR NO KEY UPDATE`, not `FOR UPDATE`: it still serialises two first PATCHes, but it
 * doesn't conflict with the `FOR KEY SHARE` lock that inserting a row with a `user_id` foreign key takes (the GST
 * steps insert `gst_checks` / `gst_representative_proofs` rows while holding the business lock), so a profile save and
 * a GST step can't deadlock on the user and business rows.
 */
async function userRow(conn: Db | Tx, userId: string, lock = false) {
  const query = conn.select().from(users).where(eq(users.id, userId));
  const [user] = lock ? await query.for('no key update') : await query;
  if (!user) throw new NotFoundError('User');
  return user;
}

/**
 * GET /businesses/me. `displayName` is GST's trade name, else the legal name, while a `gst` verification is active
 * (and `nameLocked` is true); otherwise `trade_name`. Category ids no longer active level-1 nodes are dropped.
 */
export async function getMyBusiness(db: Db | Tx, userId: string): Promise<BusinessProfile> {
  const user = await userRow(db, userId);
  if (!user.businessId) throw noBusiness();
  return businessProfile(db, user.businessId, user.name);
}

/**
 * One business's profile, as `GET /businesses/me` shows it (also the admin detail's, spec §8.2). `userName` is the
 * person whose onboarding step is computed (the signed-in user, or the owner for an admin). `404 NO_BUSINESS` when the
 * business doesn't exist.
 */
export async function businessProfile(db: Db | Tx, businessId: string, userName: string | null): Promise<BusinessProfile> {
  const [row] = await db
    .select({
      b: businesses,
      areaName: industrialAreas.name,
      lat: sql<number | null>`ST_Y(${businesses.location}::geometry)`,
      lng: sql<number | null>`ST_X(${businesses.location}::geometry)`,
    })
    .from(businesses)
    .leftJoin(industrialAreas, eq(industrialAreas.id, businesses.industrialAreaId))
    .where(eq(businesses.id, businessId));
  if (!row) throw noBusiness();
  const b = row.b;

  const categoryIds = await activeCategoryIds(db, b.categories);
  const gst = await activeGst(db, b.id);
  const current = { ...b, categories: categoryIds };

  return {
    id: b.id,
    userName,
    tradeName: b.tradeName,
    legalName: b.legalName,
    displayName: gst ? (gst.tradeName ?? b.legalName ?? b.tradeName) : b.tradeName, // as businessDisplayName
    nameLocked: gst !== null,
    activities: b.activities,
    categories: categoryIds,
    email: b.email,
    yearEstablished: b.yearEstablished,
    employees: b.employees,
    location: {
      pincode: b.pincode,
      city: b.city,
      state: b.state,
      industrialAreaId: b.industrialAreaId,
      industrialAreaName: row.areaName,
      industrialAreaOther: b.industrialAreaOther,
      addressLine: b.addressLine,
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
    },
    gstin: b.gstin,
    constitution: b.constitution,
    gstRegisteredOn: b.gstRegisteredOn,
    gstAddress: b.gstAddress ?? null,
    verificationLevels: b.verificationLevels as VerificationLevel[],
    verificationStatus: b.verificationStatus,
    verifiedAt: b.verifiedAt ? b.verifiedAt.toISOString() : null,
    onboarding: onboardingStep(current, userName),
    completion: {
      name: filled(userName) && filled(b.tradeName),
      activities: b.activities.length > 0 && categoryIds.length > 0,
      location: locationDone(b),
      gst: gst !== null,
    },
  };
}

export interface ProfilePatch {
  name?: string;
  businessName?: string;
  activities?: BusinessActivity[];
  categories?: string[];
  email?: string | null;
  yearEstablished?: number | null;
  employees?: EmployeeRange | null;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function checkActivities(activities: BusinessActivity[]): BusinessActivity[] {
  const list = unique(activities);
  if (list.length === 0 || !list.every((a) => (BUSINESS_ACTIVITIES as readonly string[]).includes(a))) {
    throw new ValidationError('Choose at least one of buy, sell, rent out');
  }
  return list;
}

function checkYear(year: number | null | undefined): void {
  if (year === null || year === undefined) return;
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > thisYear) {
    throw new ValidationError(`Year established must be between 1900 and ${thisYear}`);
  }
}

async function checkCategories(tx: Tx, ids: string[]): Promise<string[]> {
  const list = unique(ids);
  const active = await activeCategoryIds(tx, list);
  if (active.length !== list.length) {
    const bad = list.filter((id) => !active.includes(id));
    throw new ValidationError('Pick machine categories from the list', { categories: bad }, 'INVALID_CATEGORY');
  }
  return list;
}

/**
 * PATCH /businesses/me. With no business yet (R1) it creates one, linking `users.business_id`: then `name`,
 * `businessName` and a non-empty `activities` are required. The business name can't change while GST is verified
 * (`409 NAME_LOCKED`); categories must be active machine categories (`400 INVALID_CATEGORY`).
 */
export async function updateMyProfile(db: Db, userId: string, patch: ProfilePatch): Promise<BusinessProfile> {
  const activities = patch.activities === undefined ? undefined : checkActivities(patch.activities);
  checkYear(patch.yearEstablished);

  await db.transaction(async (tx) => {
    // Locking the user serialises two first PATCHes, so a user never ends up with two businesses.
    const user = await userRow(tx, userId, true);
    const categoryIds = patch.categories === undefined ? undefined : await checkCategories(tx, patch.categories);

    if (!user.businessId) {
      if (!patch.name || !patch.businessName || !activities) {
        throw new ValidationError('Your name, business name and what you do are needed to set up your business');
      }
      const [created] = await tx
        .insert(businesses)
        .values({
          tradeName: patch.businessName,
          activities,
          categories: categoryIds ?? [],
          email: patch.email ?? null,
          yearEstablished: patch.yearEstablished ?? null,
          employees: patch.employees ?? null,
        })
        .returning({ id: businesses.id });
      await tx.update(users).set({ name: patch.name, businessId: created!.id, updatedAt: new Date() }).where(eq(users.id, userId));
      return;
    }

    // The grant (GST) locks the business row too, so the name check and the update see one state. `FOR NO KEY UPDATE`
    // (never `FOR UPDATE`): this never changes a key column, and F6 inserts referencing the business take `KEY SHARE`.
    const [b] = await tx.select().from(businesses).where(eq(businesses.id, user.businessId)).for('no key update');
    if (!b) throw noBusiness();
    if (patch.businessName !== undefined && patch.businessName !== b.tradeName && (await activeGst(tx, b.id))) {
      throw new ConflictError("Your business name comes from your GST registration and can't be changed", 'NAME_LOCKED');
    }
    await tx
      .update(businesses)
      .set({
        tradeName: patch.businessName,
        activities,
        categories: categoryIds,
        email: patch.email,
        yearEstablished: patch.yearEstablished,
        employees: patch.employees,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, b.id));
    if (patch.name !== undefined) {
      await tx.update(users).set({ name: patch.name, updatedAt: new Date() }).where(eq(users.id, userId));
    }
  });

  return getMyBusiness(db, userId);
}

export interface LocationInput {
  pincode: string;
  city: string;
  state: string;
  industrialAreaId?: string | null;
  industrialAreaOther?: string | null;
  addressLine?: string | null;
  lat?: number;
  lng?: number;
}

/** True when `areaId` is a listed area of the pincode's district and state, inactive ones included. */
async function areaOfPincode(tx: Tx, areaId: string, pincode: string): Promise<boolean> {
  const where = await pincodeDistrict(tx, pincode);
  if (!where) return false;
  const [row] = await tx
    .select({ id: industrialAreas.id })
    .from(industrialAreas)
    .where(and(eq(industrialAreas.id, areaId), sql`lower(${industrialAreas.city}) = lower(${where.city})`, eq(industrialAreas.state, where.state)));
  return !!row;
}

/**
 * PUT /businesses/me/location: replaces the whole location. Exactly one of a listed area and Other. A listed area must
 * be an active area of the pincode's district and state (`areasForPincode`), else `400 AREA_MISMATCH`; the area the
 * business already has stays allowed after an admin deactivates it (businesses keep it, spec §4.3). `lat` and `lng`
 * come together and set the pin; without them the pin is cleared. Every non-removed listing whose location is the
 * business's moves with it (F2 spec §4.7, R19).
 */
export async function setMyLocation(db: Db, userId: string, body: LocationInput): Promise<BusinessProfile> {
  const areaId = body.industrialAreaId ?? null;
  const other = body.industrialAreaOther?.trim() || null;
  if ((areaId === null) === (other === null)) throw new ValidationError('Pick an industrial area or type one under Other');
  const hasLat = body.lat !== undefined;
  if (hasLat !== (body.lng !== undefined)) throw new ValidationError('Send lat and lng together');

  await db.transaction(async (tx) => {
    const user = await userRow(tx, userId);
    if (!user.businessId) throw noBusiness();
    // `FOR NO KEY UPDATE`, not `FOR UPDATE`: F6 inserts rows referencing this business (offers, deals, threads,
    // notifications: `KEY SHARE`) while holding a listing lock, and `syncBusinessListings` below locks those listings.
    // A `FOR UPDATE` here would deadlock with them (40P01); no key column of `businesses` changes.
    const [b] = await tx.select().from(businesses).where(eq(businesses.id, user.businessId)).for('no key update');
    if (!b) throw noBusiness();

    if (areaId) {
      const listed = (await areasForPincode(tx, body.pincode)).some((a) => a.id === areaId);
      const kept = !listed && areaId === b.industrialAreaId && (await areaOfPincode(tx, areaId, body.pincode));
      if (!listed && !kept) {
        throw new ValidationError("That industrial area isn't in this pincode's district", undefined, 'AREA_MISMATCH');
      }
    }

    await tx
      .update(businesses)
      .set({
        pincode: body.pincode,
        city: body.city,
        state: body.state,
        industrialAreaId: areaId,
        industrialAreaOther: other,
        addressLine: body.addressLine?.trim() || null,
        location: hasLat ? sql`ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)::geography` : null,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, b.id));
    // F2 R19: business-sourced listings follow, in this transaction and after the business lock (the listing lock order).
    await syncBusinessListings(tx, b.id);
    // F8 §8.1: the business's live part / machine listings that follow its location are re-matched.
    const moved = await tx
      .select({ id: listings.id })
      .from(listings)
      .where(
        and(
          eq(listings.businessId, b.id),
          eq(listings.locationSource, 'business'),
          eq(listings.status, 'live'),
          inArray(listings.kind, ['part', 'machine']),
        ),
      );
    await enqueueListingsChanged(tx, moved.map((l) => l.id));
  });

  return getMyBusiness(db, userId);
}
