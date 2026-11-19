import {
  pgTable, uuid, text, timestamp, pgEnum, boolean, jsonb, customType, index, uniqueIndex, unique, integer, smallint,
  numeric, date, bigint, bigserial, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  ACCOUNT_STATUSES, ADMIN_ROLES, CATALOG_LEVELS, CATALOG_STATUSES, EMPLOYEE_RANGES, FIELD_APPLIES_TO, FIELD_TYPES,
  FITMENT_SOURCES, GST_CHECK_RESULTS, GST_PRICE_MODES, GST_PROOF_STATUSES, GST_STATUSES, LANGUAGES, LISTING_ACTORS,
  LISTING_KINDS, LISTING_LOCATION_SOURCES, LISTING_STATUSES, MEDIA_TYPES, MEMBER_ROLES, MODERATION_OUTCOMES, PART_SIDES,
  PRICE_MODELS, RENTAL_FUEL_OPTIONS, RENTAL_OPERATOR_OPTIONS, RENTAL_PERIODS, RENTAL_TRANSPORT_OPTIONS, REPORT_STATUSES,
  REPORT_TARGETS, SEARCH_REFRESH_SCOPES, SEARCH_SCRIPTS, SYNONYM_TARGETS, VERIFICATION_LEVELS, VERIFICATION_STATUSES,
  CONSENT_KINDS, DEAL_ACTOR_SIDES, DEAL_CANCELLED_BY, DEAL_COMPLETED_HOW, DEAL_FULFILMENT, DEAL_PAYMENT_METHODS, DEAL_STATUSES,
  DELIVERY_STATES, DEVICE_PLATFORMS, DISPUTE_OUTCOMES, DISPUTE_STATUSES, HOLD_STATUSES, MESSAGE_KINDS, NOTIFICATION_CATEGORIES,
  OFFER_KINDS, OFFER_STATUSES, PARTY_SIDES,
  type BusinessActivity, type ConsentPhoneSource, type ConsentWithdrawReason, type DealEventCode, type DeliveryOption,
  type DisputeCategory, type EnquiryMachine, type NotificationType, type QuickEnquiry, type SystemLineCode,
  type GstDetails, type GstDocumentType, type GstEnteredDetails, type ListingFlag, type ReviewReason, type Specs,
} from '@mpm/shared-types';

// Starting schema only: admin auth, the business/user core (scope F1, A2) and the audit log. Listings, enquiries,
// offers, deals, rental bookings and part requests are added per feature, then `pnpm --filter @mpm/api db:generate`.
// Never hand-edit or delete files in infra/migrations — always generate new ones.

/** PostGIS geography (SRID 4326 by default; store points only). Write with `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` in raw SQL. */
const geography = customType<{ data: string }>({ dataType: () => 'geography' });

export const adminRole = pgEnum('admin_role', ADMIN_ROLES);
export const memberRole = pgEnum('member_role', MEMBER_ROLES);
export const language = pgEnum('language', LANGUAGES);
export const verificationStatus = pgEnum('verification_status', VERIFICATION_STATUSES);
export const catalogLevel = pgEnum('catalog_level', CATALOG_LEVELS);
export const fieldType = pgEnum('field_type', FIELD_TYPES);
export const catalogStatus = pgEnum('catalog_status', CATALOG_STATUSES);
export const fieldAppliesTo = pgEnum('field_applies_to', FIELD_APPLIES_TO);
export const accountStatus = pgEnum('account_status', ACCOUNT_STATUSES);
export const employeesRange = pgEnum('employees_range', EMPLOYEE_RANGES);
export const verificationLevel = pgEnum('verification_level', VERIFICATION_LEVELS);
export const gstStatus = pgEnum('gst_status', GST_STATUSES);
export const gstCheckResult = pgEnum('gst_check_result', GST_CHECK_RESULTS);
/** Who ran a lookup: the business itself, or an officer at approval. Only `business` lookups count toward the daily limit. */
export const gstCheckSource = pgEnum('gst_check_source', ['business', 'officer']);
export const gstProofStatus = pgEnum('gst_proof_status', GST_PROOF_STATUSES);
export const gstProofMethod = pgEnum('gst_proof_method', ['provider_otp', 'documents']);
export const verificationMethod = pgEnum('verification_method', ['provider_otp', 'officer_review']);
/** What revoked a verification. Only officers revoke for now (F1 spec §5.4). */
export const revocationSource = pgEnum('revocation_source', ['officer']);

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: adminRole('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Admin-managed industrial areas (F1 spec §4.3), picked per pincode district and state. */
export const industrialAreas = pgTable(
  'industrial_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // drizzle-kit 0.22 emits expressions here, but its types only accept columns.
    nameCityStateUq: uniqueIndex('industrial_areas_name_city_state_uq').on(
      sql`lower(${t.name})` as unknown as typeof t.name,
      sql`lower(${t.city})` as unknown as typeof t.city,
      t.state,
    ),
  }),
);

/** A business profile (scope F1). One account can buy and sell. */
export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: text('legal_name'),
    tradeName: text('trade_name').notNull(),
    gstin: text('gstin').unique(),
    pan: text('pan'),
    /** Buy, sell, rent out: one or more (F1 spec §4.1). The service refuses an empty list on write. */
    activities: text('activities').array().$type<BusinessActivity[]>().notNull().default(sql`'{}'::text[]`),
    email: text('email'),
    yearEstablished: integer('year_established'),
    employees: employeesRange('employees'),
    /** Location and industrial area (scope F1, F5: search by city / industrial area / state). */
    addressLine: text('address_line'),
    /** A listed area, or the business's own "Other" text; never both (`businesses_area_one_of`, custom migration). */
    industrialAreaId: uuid('industrial_area_id').references(() => industrialAreas.id),
    industrialAreaOther: text('industrial_area_other'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    location: geography('location'),
    /** Machine categories the business deals in (category ids once A4 exists). */
    categories: jsonb('categories').$type<string[]>().notNull().default([]),
    /** From the verified GST registration (F1 spec §5.2 step 6). */
    constitution: text('constitution'),
    gstRegisteredOn: date('gst_registered_on'),
    gstAddress: jsonb('gst_address').$type<GstDetails['address']>(),
    verificationLevels: jsonb('verification_levels').$type<string[]>().notNull().default(['phone']),
    /** GST / business verification review by an admin (scope A2). */
    verificationStatus: verificationStatus('verification_status').notNull().default('not_submitted'),
    verificationNote: text('verification_note'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** F6 + F7 §5.12: the owner's OTP-verified contact number (E.164), revealed only after a deal and both ticks (R6). Never public. */
    contactPhone: text('contact_phone'),
    contactPhoneVerifiedAt: timestamp('contact_phone_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    locationIdx: index('businesses_location_idx').using('gist', t.location),
    cityIdx: index('businesses_city_idx').on(t.city),
    cityAreaIdx: index('businesses_city_industrial_area_idx').on(t.city, t.industrialAreaId),
  }),
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').references(() => businesses.id),
    phone: text('phone').notNull().unique(),
    name: text('name'),
    memberRole: memberRole('member_role').notNull().default('owner'),
    language: language('language').notNull().default('en'),
    /** Suspend / block (scope A2). */
    status: accountStatus('status').notNull().default('active'),
    /** F6 + F7 §5.13, §11.6: one switch for every push; in-app rows are always written. */
    pushEnabled: boolean('push_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Keeps the "owner not suspended" EXISTS of `publicListingWhere` cheap (F2 spec §7.1, R49).
  (t) => ({ businessIdIdx: index('users_business_id_idx').on(t.businessId) }),
);

/** Every admin action: who, what, when, before/after. */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').references(() => adminUsers.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── A4 machine catalogue ───
// No ON DELETE CASCADE anywhere: deletes are guarded in services.

/** `decimals` is checked 0-3 by `units_decimals_range` (custom migration; drizzle-kit 0.22 cannot emit CHECKs). */
export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  decimals: smallint('decimals').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  /** Machines and rentals use the first active unit with this flag (F2 spec §4.2, R48). */
  isMachineUnit: boolean('is_machine_unit').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conditions = pgTable('conditions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Category tree: machine category > machine type > part group. `path` is the unique slug path. */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    level: catalogLevel('level').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    path: text('path').notNull().unique(),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /** Null inherits from the parent. */
    hasSides: boolean('has_sides'),
    sideConvention: text('side_convention'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ parentIdIdx: index('categories_parent_id_idx').on(t.parentId) }),
);

/** Listing-template field attached to a category node (inherited down the tree). */
export const templateFields = pgTable(
  'template_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    key: text('key').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    type: fieldType('type').notNull(),
    appliesTo: fieldAppliesTo('applies_to').notNull().default('both'),
    unit: text('unit'),
    min: numeric('min', { precision: 14, scale: 3 }),
    max: numeric('max', { precision: 14, scale: 3 }),
    required: boolean('required').notNull().default(false),
    filterable: boolean('filterable').notNull().default(false),
    highlightRank: smallint('highlight_rank'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: catalogStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ categoryKey: unique('template_fields_category_key_uq').on(t.categoryId, t.key) }),
);

export const templateFieldOptions = pgTable(
  'template_field_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => templateFields.id),
    key: text('key').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: catalogStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ fieldKey: unique('template_field_options_field_key_uq').on(t.fieldId, t.key) }),
);

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  makesMachines: boolean('makes_machines').notNull().default(true),
  makesParts: boolean('makes_parts').notNull().default(false),
  needsReview: boolean('needs_review').notNull().default(false),
  /**
   * F4 + F5 §4.1: the query reader makes this brand a chip only when a model of the brand or a machine type is also read
   * (brand names that are ordinary words: Bull, ACE).
   */
  chipNeedsContext: boolean('chip_needs_context').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A brand's model of one machine type. Names are unique per brand and type, ignoring case. */
export const machineModels = pgTable(
  'machine_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id),
    machineTypeId: uuid('machine_type_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    brandKey: unique('machine_models_brand_key_uq').on(t.brandId, t.key),
    // drizzle-kit 0.22 emits an expression in the last position, but its types only accept columns there.
    brandTypeName: uniqueIndex('machine_models_brand_type_name_uq').on(
      t.brandId,
      t.machineTypeId,
      sql`lower(${t.name})` as unknown as typeof t.name,
    ),
    machineTypeIdx: index('machine_models_machine_type_id_idx').on(t.machineTypeId),
  }),
);

// ─── F1 + A2: location directory and GST verification (spec 2026-11-18-f1-a2 §9) ───
// Business and system actions live in these tables; `audit_log` holds officer actions only (§5.6).

/** One row per post office, so several per pincode (ported from textile). `point` is geography(Point,4326). */
export const pincodeOffices = pgTable(
  'pincode_offices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pincode: text('pincode').notNull(),
    officeName: text('office_name').notNull(),
    district: text('district').notNull(),
    state: text('state').notNull(),
    point: geography('point'),
  },
  (t) => ({
    pincodeIdx: index('pincode_offices_pincode_idx').on(t.pincode),
    pointIdx: index('pincode_offices_point_idx').using('gist', t.point),
  }),
);

/** One GSTIN lookup (§5.2). Officer lookups at approval are `source = officer` with `admin_id` and no `user_id`. */
export const gstChecks = pgTable(
  'gst_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    userId: uuid('user_id').references(() => users.id),
    /** Normalised (`normalizeGstin`). */
    gstin: text('gstin').notNull(),
    source: gstCheckSource('source').notNull(),
    adminId: uuid('admin_id').references(() => adminUsers.id),
    result: gstCheckResult('result').notNull(),
    providerRef: text('provider_ref'),
    gstStatus: gstStatus('gst_status'),
    /** Only the registration fields the product uses. */
    details: jsonb('details').$type<GstDetails>(),
    /** When the provider answered: confirm must happen within 30 minutes of it. Null when the lookup failed. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ businessCreatedIdx: index('gst_checks_business_created_idx').on(t.businessId, t.createdAt) }),
);


/**
 * The authorised-representative proof (§5.2 steps 4-5, §5.3): a declaration, then a registered-contact code
 * (instant path) or documents (officer review). `check_id` is null when no lookup is attached.
 */
export const gstRepresentativeProofs = pgTable(
  'gst_representative_proofs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checkId: uuid('check_id').references(() => gstChecks.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The GSTIN this proof is for: a review can be for a different GSTIN than the one the business holds. */
    gstin: text('gstin').notNull(),
    declarationVersion: integer('declaration_version').notNull(),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
    method: gstProofMethod('method'),
    status: gstProofStatus('status').notNull().default('declared'),
    /** The provider's OTP reference; the code itself is never stored. */
    otpRef: text('otp_ref'),
    otpHint: text('otp_hint'),
    otpSends: integer('otp_sends').notNull().default(0),
    otpAttempts: integer('otp_attempts').notNull().default(0),
    lastOtpSentAt: timestamp('last_otp_sent_at', { withTimezone: true }),
    passedAt: timestamp('passed_at', { withTimezone: true }),
    entered: jsonb('entered').$type<GstEnteredDetails>(),
    /** Private-bucket (R2) keys. */
    documents: jsonb('documents').$type<Array<{ key: string; type: GstDocumentType }>>().notNull().default([]),
    officerId: uuid('officer_id').references(() => adminUsers.id),
    /** The officer's ask-for-more message. */
    officerMessage: text('officer_message'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** The officer's rejection reason. */
    reason: text('reason'),
    /** The details the GSTIN was granted with on approval. */
    approvedDetails: jsonb('approved_details').$type<GstDetails>(),
    /** The fresh lookup at approval: `active`, `unavailable` (provider down) or `none` (mode `review`). */
    lookupAtApproval: text('lookup_at_approval').$type<'active' | 'unavailable' | 'none'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCreatedIdx: index('gst_proofs_status_created_idx').on(t.status, t.createdAt),
    businessCreatedIdx: index('gst_proofs_business_created_idx').on(t.businessId, t.createdAt),
    oneOpenReviewUq: uniqueIndex('gst_proofs_one_open_review_uq')
      .on(t.businessId)
      .where(sql`${t.status} IN ('waiting', 'needs_more')`),
  }),
);

/**
 * Verification grants and revocations (§5.4). `businesses.verification_levels` is the read model of the active rows,
 * written in the same transaction. One active row per (business, level).
 */
export const businessVerifications = pgTable(
  'business_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    level: verificationLevel('level').notNull(),
    method: verificationMethod('method'),
    reason: text('reason').notNull(),
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    verifiedByAdminId: uuid('verified_by_admin_id').references(() => adminUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    revokedByAdminId: uuid('revoked_by_admin_id').references(() => adminUsers.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    /** Any row with `officer` closes the instant path for the business for good (§5.4). */
    revocationSource: revocationSource('revocation_source'),
    /** The passed or approved representative proof a `gst` verification was granted with. */
    verifiedByProofId: uuid('verified_by_proof_id').references((): AnyPgColumn => gstRepresentativeProofs.id),
  },
  (t) => ({
    activeUq: uniqueIndex('business_verifications_active_uq').on(t.businessId, t.level).where(sql`${t.status} = 'active'`),
  }),
);

// ─── F2 + F3 + A3: listings (spec 2026-11-18-f2-f3 §13) ───
// No ON DELETE CASCADE: draft deletion and test cleanup delete children first. CHECKs, the `ref` sequence restart and
// the `is_machine_unit` data update are in the custom migration that follows the generated one.

export const listingKind = pgEnum('listing_kind', LISTING_KINDS);
export const listingStatus = pgEnum('listing_status', LISTING_STATUSES);
export const partSide = pgEnum('part_side', PART_SIDES);
export const priceModel = pgEnum('price_model', PRICE_MODELS);
export const gstPriceMode = pgEnum('gst_price_mode', GST_PRICE_MODES);
export const rentalPeriod = pgEnum('rental_period', RENTAL_PERIODS);
export const rentalOperator = pgEnum('rental_operator', RENTAL_OPERATOR_OPTIONS);
export const rentalFuel = pgEnum('rental_fuel', RENTAL_FUEL_OPTIONS);
export const rentalTransport = pgEnum('rental_transport', RENTAL_TRANSPORT_OPTIONS);
export const listingLocationSource = pgEnum('listing_location_source', LISTING_LOCATION_SOURCES);
export const mediaType = pgEnum('media_type', MEDIA_TYPES);
export const moderationOutcome = pgEnum('moderation_outcome', MODERATION_OUTCOMES);
export const historyActor = pgEnum('history_actor', LISTING_ACTORS);
export const fitmentSource = pgEnum('fitment_source', FITMENT_SOURCES);
export const reportTarget = pgEnum('report_target', REPORT_TARGETS);
export const reportStatus = pgEnum('report_status', REPORT_STATUSES);

/**
 * A part, a machine for sale or a machine for rent (§4). `status` is written only by `listing-lifecycle.service.ts`.
 * Location columns are copied from the business (source `business`) or a godown; `address_line` (godown only),
 * `pincode` and `point` are private.
 */
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Shown as #100001 (the custom migration restarts the sequence at 100001, R35). */
    ref: bigserial('ref', { mode: 'number' }).notNull().unique(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    kind: listingKind('kind').notNull(),
    status: listingStatus('status').notNull().default('draft'),
    /** Part group (parts) or machine type (machines, rentals); null in a fresh draft. */
    categoryId: uuid('category_id').references(() => categories.id),
    title: text('title'),
    /** `normalizePartName(title)`, for Other-side matching (§9.1). */
    titleNorm: text('title_norm'),
    description: text('description'),
    partNumber: text('part_number'),
    partNumberNorm: text('part_number_norm'),
    partNumberBase: text('part_number_base'),
    partBrandId: uuid('part_brand_id').references(() => brands.id),
    side: partSide('side'),
    specs: jsonb('specs').$type<Specs>().notNull().default({}),
    quantity: numeric('quantity', { precision: 14, scale: 3 }),
    /**
     * F6 + F7 §5.7: the sum of active stock holds, written only by `services/deals/holds.ts` with the hold row.
     * Available = quantity − held_quantity. CHECK `listings_held_quantity_range` (custom migration).
     */
    heldQuantity: numeric('held_quantity', { precision: 14, scale: 3 }).notNull().default('0'),
    unitId: uuid('unit_id').references(() => units.id),
    minOrderQty: numeric('min_order_qty', { precision: 14, scale: 3 }),
    conditionId: uuid('condition_id').references(() => conditions.id),
    conditionNote: text('condition_note'),
    priceModel: priceModel('price_model'),
    pricePaise: bigint('price_paise', { mode: 'number' }),
    gstMode: gstPriceMode('gst_mode'),
    locationSource: listingLocationSource('location_source').notNull().default('business'),
    pincode: text('pincode'),
    city: text('city'),
    state: text('state'),
    industrialAreaId: uuid('industrial_area_id').references(() => industrialAreas.id),
    industrialAreaOther: text('industrial_area_other'),
    addressLine: text('address_line'),
    point: geography('point'),
    delivery: text('delivery').array().$type<DeliveryOption[]>().notNull().default(sql`'{}'::text[]`),
    flags: text('flags').array().$type<ListingFlag[]>().notNull().default(sql`'{}'::text[]`),
    acceptedFlags: text('accepted_flags').array().$type<ListingFlag[]>().notNull().default(sql`'{}'::text[]`),
    reviewReasons: text('review_reasons').array().$type<ReviewReason[]>().notNull().default(sql`'{}'::text[]`),
    /** Where `unhide` and an approval after `back_to_review` go (R44). */
    returnStatus: listingStatus('return_status'),
    moderationOutcome: moderationOutcome('moderation_outcome'),
    moderationNote: text('moderation_note'),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatedBy: uuid('moderated_by').references(() => adminUsers.id),
    /** Hide / remove reason, or the seller's note. */
    statusReason: text('status_reason'),
    /** +1 on every content change; admin decisions send it back (R53). */
    version: integer('version').notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    firstLiveAt: timestamp('first_live_at', { withTimezone: true }),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    // F4 + F5 search columns (spec 2026-11-19-f4-f5 §4.1): written only by `services/discovery/search-text.ts`.
    /** Normalised title, part number (spaced and compact forms), part brand and category path names. */
    searchTitleText: text('search_title_text').notNull().default(''),
    /** `search_title_text` + fitment / machine brand and model names, spec values, condition label. No side words. */
    searchText: text('search_text').notNull().default(''),
    /** `point`, else the centroid of the pincode's offices (R5). */
    searchPoint: geography('search_point'),
    searchRefreshedAt: timestamp('search_refreshed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pointIdx: index('listings_point_idx').using('gist', t.point),
    searchTextTrgmIdx: index('listings_search_text_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    searchTitleTextTrgmIdx: index('listings_search_title_text_trgm_idx').using('gin', t.searchTitleText.op('gin_trgm_ops')),
    searchPointIdx: index('listings_search_point_idx').using('gist', t.searchPoint),
    publicRefreshedIdx: index('listings_public_refreshed_idx')
      .on(t.kind, t.refreshedAt.desc())
      .where(sql`${t.status} IN ('live', 'reserved', 'rented')`),
    statusKindCategoryIdx: index('listings_status_kind_category_idx').on(t.status, t.kind, t.categoryId),
    businessStatusUpdatedIdx: index('listings_business_status_updated_idx').on(t.businessId, t.status, t.updatedAt),
    categoryIdx: index('listings_category_id_idx').on(t.categoryId),
    partNumberNormIdx: index('listings_part_number_norm_idx').on(t.partNumberNorm).where(sql`${t.partNumberNorm} IS NOT NULL`),
    partNumberBaseIdx: index('listings_part_number_base_idx').on(t.partNumberBase).where(sql`${t.partNumberBase} IS NOT NULL`),
    statusRefreshedIdx: index('listings_status_refreshed_idx').on(t.status, t.refreshedAt),
  }),
);

/** Machine fields (§4.4), 1 : 1 with a `machine` or `machine_rental` listing. `serial_number` is private. */
export const listingMachines = pgTable(
  'listing_machines',
  {
    listingId: uuid('listing_id')
      .primaryKey()
      .references(() => listings.id),
    brandId: uuid('brand_id').references(() => brands.id),
    brandOther: text('brand_other'),
    modelId: uuid('model_id').references(() => machineModels.id),
    modelOther: text('model_other'),
    year: smallint('year'),
    hoursRun: integer('hours_run'),
    serialNumber: text('serial_number'),
    underPower: boolean('under_power').notNull().default(false),
    inspectionByAppointment: boolean('inspection_by_appointment').notNull().default(false),
    reasonForSale: text('reason_for_sale'),
  },
  (t) => ({
    brandIdx: index('listing_machines_brand_id_idx').on(t.brandId),
    modelIdx: index('listing_machines_model_id_idx').on(t.modelId),
  }),
);

/** Rental terms (§4.5), 1 : 1 with a `machine_rental` listing. Money in paise. */
export const listingRentals = pgTable('listing_rentals', {
  listingId: uuid('listing_id')
    .primaryKey()
    .references(() => listings.id),
  rateHourPaise: bigint('rate_hour_paise', { mode: 'number' }),
  rateDayPaise: bigint('rate_day_paise', { mode: 'number' }),
  rateWeekPaise: bigint('rate_week_paise', { mode: 'number' }),
  rateMonthPaise: bigint('rate_month_paise', { mode: 'number' }),
  shiftHours: smallint('shift_hours').notNull().default(8),
  monthDays: smallint('month_days').notNull().default(26),
  overtimeRateHourPaise: bigint('overtime_rate_hour_paise', { mode: 'number' }),
  minDuration: smallint('min_duration'),
  minDurationPeriod: rentalPeriod('min_duration_period'),
  operator: rentalOperator('operator'),
  operatorRateDayPaise: bigint('operator_rate_day_paise', { mode: 'number' }),
  fuel: rentalFuel('fuel').notNull().default('client'),
  transport: rentalTransport('transport'),
  transportChargePaise: bigint('transport_charge_paise', { mode: 'number' }),
  serviceRadiusKm: smallint('service_radius_km'),
  depositPaise: bigint('deposit_paise', { mode: 'number' }),
  availableFrom: date('available_from'),
  availabilityNote: text('availability_note'),
});

/** "Fits" rows of a part (§4.3): brand required; a model, "Other" text or neither (= all models); years; note. */
export const listingFitments = pgTable(
  'listing_fitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id),
    modelId: uuid('model_id').references(() => machineModels.id),
    modelOther: text('model_other'),
    yearFrom: smallint('year_from'),
    yearTo: smallint('year_to'),
    note: text('note'),
    source: fitmentSource('source').notNull().default('seller'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    listingIdx: index('listing_fitments_listing_id_idx').on(t.listingId),
    modelIdx: index('listing_fitments_model_id_idx').on(t.modelId),
    brandIdx: index('listing_fitments_brand_id_idx').on(t.brandId),
  }),
);

/** Photos and videos (§6): public-bucket keys only, URLs built at read time. `thumb_key` = photo thumb or video poster. */
export const listingMedia = pgTable(
  'listing_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    type: mediaType('type').notNull(),
    key: text('key').notNull(),
    thumbKey: text('thumb_key'),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ listingSortIdx: index('listing_media_listing_sort_idx').on(t.listingId, t.sortOrder) }),
);

/** Every status change (§7.5). `from_status` is null for the first. */
export const listingStatusHistory = pgTable(
  'listing_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    fromStatus: listingStatus('from_status'),
    toStatus: listingStatus('to_status').notNull(),
    action: text('action').notNull(),
    actor: historyActor('actor').notNull(),
    userId: uuid('user_id').references(() => users.id),
    adminId: uuid('admin_id').references(() => adminUsers.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ listingCreatedIdx: index('listing_status_history_listing_created_idx').on(t.listingId, t.createdAt) }),
);

/** Generic reports (A6-ready); listings are the only target in F2 (§8.4). One open report per business and target. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: reportTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reporterUserId: uuid('reporter_user_id').references(() => users.id),
    reporterBusinessId: uuid('reporter_business_id').references(() => businesses.id),
    reason: text('reason').notNull(),
    details: text('details'),
    status: reportStatus('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => adminUsers.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetStatusIdx: index('reports_target_status_idx').on(t.targetType, t.targetId, t.status),
    oneOpenUq: uniqueIndex('reports_one_open_uq')
      .on(t.reporterBusinessId, t.targetType, t.targetId)
      .where(sql`${t.status} IN ('open', 'reviewing')`),
  }),
);

/** Marketplace settings (§12): the registry (`APP_SETTINGS`) is code; a missing row means the default. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedByAdminId: uuid('updated_by_admin_id').references(() => adminUsers.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── F4 + F5: discovery (spec 2026-11-19-f4-f5-discovery-design §4) ───
// The CHECK on `search_synonyms`, its unique index (plain columns `term_norm, target_kind, target_id, target_side,
// target_word` with NULLS NOT DISTINCT: an enum-to-text cast can't be indexed, and the CHECK leaves exactly one target
// column set), the query length CHECK and the SQL normaliser `mpm_normalize_search` are in the custom migration that
// follows the generated one.

export const searchScript = pgEnum('search_script', SEARCH_SCRIPTS);
export const synonymTarget = pgEnum('synonym_target', SYNONYM_TARGETS);
export const searchRefreshScope = pgEnum('search_refresh_scope', SEARCH_REFRESH_SCOPES);

/**
 * Admin-managed search synonyms (§4.2). Exactly the target field of `target_kind` is set (CHECK
 * `search_synonyms_target_shape`); `target_id` has no foreign key (category, brand or model: checked in the service).
 * Seeded rows have no `created_by`.
 */
export const searchSynonyms = pgTable('search_synonyms', {
  id: uuid('id').primaryKey().defaultRandom(),
  term: text('term').notNull(),
  termNorm: text('term_norm').notNull(),
  script: searchScript('script').notNull(),
  targetKind: synonymTarget('target_kind').notNull(),
  targetId: uuid('target_id'),
  targetSide: partSide('target_side'),
  targetWord: text('target_word'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => adminUsers.id),
  updatedBy: uuid('updated_by').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The anonymous search log (§4.3, R14): no user, device, IP or location. `day` is the IST date. */
export const searchQueries = pgTable(
  'search_queries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    normalized: text('normalized').notNull(),
    words: smallint('words').notNull(),
    resultTotal: integer('result_total').notNull(),
    kind: listingKind('kind'),
    day: date('day').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ dayNormalizedIdx: index('search_queries_day_normalized_idx').on(t.day, t.normalized) }),
);

/** Queries the category manager hid from trending (§4.3). */
export const searchTrendingHidden = pgTable('search_trending_hidden', {
  normalized: text('normalized').primaryKey(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A user's saved listings (§4.4), at most `DISCOVERY_LIMITS.savedCap`. Deleted with the user or the listing. */
export const savedListings = pgTable(
  'saved_listings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: 'saved_listings_pk', columns: [t.userId, t.listingId] }),
    userCreatedIdx: index('saved_listings_user_created_idx').on(t.userId, t.createdAt.desc(), t.listingId),
  }),
);

/** Background rebuilds of search text after a catalogue change (§4.5, §5.2); pending while `done_at` is null. */
export const searchRefreshJobs = pgTable(
  'search_refresh_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scopeKind: searchRefreshScope('scope_kind').notNull(),
    scopeId: uuid('scope_id').notNull(),
    createdBy: uuid('created_by').references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => ({ pendingIdx: index('search_refresh_jobs_pending_idx').on(t.doneAt, t.createdAt) }),
);

// ─── F6 + F7: enquiries, chat, offers, deals, reviews, notifications (spec 2026-11-19-f6-f7 §5) ───
// What drizzle-kit 0.22 can't emit is in the custom migration that follows the generated one: the CHECKs (message
// shape, ≤ 5 photos, review shape, advance ≤ total, 0 ≤ held_quantity ≤ quantity, thread parties differ), F2's
// `listings_quantity_positive` relaxed to `>= 0`, `deals_ref_seq` restarted at 500001 and the append-only trigger on
// `contact_share_consents`. No migration statement uses `report_target` 'review' (§5.17).
// No ON DELETE CASCADE except a delivery's device and notification: test cleanup (`deleteF6Rows`) deletes in FK order.

export const messageKind = pgEnum('message_kind', MESSAGE_KINDS);
export const partySide = pgEnum('party_side', PARTY_SIDES);
export const offerKind = pgEnum('offer_kind', OFFER_KINDS);
export const offerStatus = pgEnum('offer_status', OFFER_STATUSES);
export const holdStatus = pgEnum('hold_status', HOLD_STATUSES);
export const dealStatus = pgEnum('deal_status', DEAL_STATUSES);
export const dealCompletedHow = pgEnum('deal_completed_how', DEAL_COMPLETED_HOW);
export const dealCancelledBy = pgEnum('deal_cancelled_by', DEAL_CANCELLED_BY);
export const dealPaymentMethod = pgEnum('deal_payment_method', DEAL_PAYMENT_METHODS);
export const dealFulfilment = pgEnum('deal_fulfilment', DEAL_FULFILMENT);
export const dealActorSide = pgEnum('deal_actor_side', DEAL_ACTOR_SIDES);
export const disputeStatus = pgEnum('dispute_status', DISPUTE_STATUSES);
export const disputeOutcome = pgEnum('dispute_outcome', DISPUTE_OUTCOMES);
export const consentKind = pgEnum('consent_kind', CONSENT_KINDS);
export const notificationCategory = pgEnum('notification_category', NOTIFICATION_CATEGORIES);
export const deliveryState = pgEnum('delivery_state', DELIVERY_STATES);
export const devicePlatform = pgEnum('device_platform', DEVICE_PLATFORMS);

/** One thread per buyer business + listing (§5.1, R1). Seller copied from the listing at creation. */
export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    buyerBusinessId: uuid('buyer_business_id')
      .notNull()
      .references(() => businesses.id),
    sellerBusinessId: uuid('seller_business_id')
      .notNull()
      .references(() => businesses.id),
    listingKind: listingKind('listing_kind').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /** Of the newest message (inbox order, unread). Written only by `services/chat/thread-lines.ts`. */
    lastMessageSeq: bigint('last_message_seq', { mode: 'number' }).notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    /** First seller message, quote or offer answer (enquiry status, §6.2). */
    firstSellerReplyAt: timestamp('first_seller_reply_at', { withTimezone: true }),
    /** Deals ever made in the thread (status `converted`). */
    dealCount: integer('deal_count').notNull().default(0),
    /** Whether each side must act (§6.10); recomputed by every transaction that changes an input (`recomputeTurns`). */
    buyerTurn: boolean('buyer_turn').notNull().default(false),
    sellerTurn: boolean('seller_turn').notNull().default(false),
    /** Newest message from each side (system lines raise both); unread = the other side's seq > my `last_read_seq`. */
    lastBuyerSeq: bigint('last_buyer_seq', { mode: 'number' }).notNull().default(0),
    lastSellerSeq: bigint('last_seller_seq', { mode: 'number' }).notNull().default(0),
    /** Set once, never cleared (R6, §6.6). */
    contactUnlockedAt: timestamp('contact_unlocked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listingBuyerUq: uniqueIndex('chat_threads_listing_buyer_uq').on(t.listingId, t.buyerBusinessId),
    buyerInboxIdx: index('chat_threads_buyer_inbox_idx').on(t.buyerBusinessId, t.lastMessageAt.desc(), t.id),
    sellerInboxIdx: index('chat_threads_seller_inbox_idx').on(t.sellerBusinessId, t.lastMessageAt.desc(), t.id),
    buyerTurnIdx: index('chat_threads_buyer_turn_idx').on(t.buyerBusinessId).where(sql`${t.buyerTurn}`),
    sellerTurnIdx: index('chat_threads_seller_turn_idx').on(t.sellerBusinessId).where(sql`${t.sellerTurn}`),
  }),
);

/**
 * Offers (§5.6, §7): one row per proposal; a counter closes the row as `countered` and inserts the next. One open
 * negotiation per thread (`offers_one_open_per_thread`).
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    buyerBusinessId: uuid('buyer_business_id')
      .notNull()
      .references(() => businesses.id),
    sellerBusinessId: uuid('seller_business_id')
      .notNull()
      .references(() => businesses.id),
    /** The first row's id; every counter carries it. */
    negotiationId: uuid('negotiation_id').notNull(),
    previousOfferId: uuid('previous_offer_id').references((): AnyPgColumn => offers.id),
    /** 0 for the opening row; +1 per counter (≤ `MAX_COUNTER_ROUNDS`). */
    round: smallint('round').notNull().default(0),
    kind: offerKind('kind').notNull(),
    senderSide: partySide('sender_side').notNull(),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id),
    /** Who must act now (open rows only). */
    turn: partySide('turn').notNull(),
    /** A revived backup the seller must reconfirm (§7.7). */
    needsReconfirm: boolean('needs_reconfirm').notNull().default(false),
    pricePerUnitPaise: bigint('price_per_unit_paise', { mode: 'number' }).notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull(),
    /** The listing's price when the negotiation opened (bounds, "% below asking"); null for a quote. */
    askingPricePaise: bigint('asking_price_paise', { mode: 'number' }),
    unitId: uuid('unit_id').references(() => units.id),
    gstMode: gstPriceMode('gst_mode'),
    validityHours: smallint('validity_hours').notNull(),
    /** Null while `backup`. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    backupSince: timestamp('backup_since', { withTimezone: true }),
    /** ≤ 500, stored as written, masked per reader. */
    note: text('note'),
    scamFlag: boolean('scam_flag').notNull().default(false),
    status: offerStatus('status').notNull().default('pending'),
    /** `OFFER_CLOSE_REASONS` when `closed`. */
    closeReason: text('close_reason'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredByUserId: uuid('answered_by_user_id').references(() => users.id),
    /** ≤ 300. */
    rejectNote: text('reject_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneOpenPerThread: uniqueIndex('offers_one_open_per_thread')
      .on(t.threadId)
      .where(sql`${t.status} IN ('pending', 'backup')`),
    listingStatusIdx: index('offers_listing_status_idx').on(t.listingId, t.status),
    pendingExpiryIdx: index('offers_pending_expiry_idx').on(t.status, t.expiresAt).where(sql`${t.status} = 'pending'`),
    buyerStatusIdx: index('offers_buyer_status_idx').on(t.buyerBusinessId, t.status),
    negotiationIdx: index('offers_negotiation_idx').on(t.negotiationId, t.round),
    threadIdx: index('offers_thread_idx').on(t.threadId, t.createdAt),
  }),
);

/** The shared deal record (§5.8, §9). Created only by an accepted offer. `ref` starts at 500001 (custom migration). */
export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ref: bigserial('ref', { mode: 'number' }).notNull().unique(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    offerId: uuid('offer_id')
      .notNull()
      .unique()
      .references(() => offers.id),
    buyerBusinessId: uuid('buyer_business_id')
      .notNull()
      .references(() => businesses.id),
    sellerBusinessId: uuid('seller_business_id')
      .notNull()
      .references(() => businesses.id),
    /** Snapshots at accept. */
    listingTitle: text('listing_title').notNull(),
    unitId: uuid('unit_id').references(() => units.id),
    unitLabel: text('unit_label').notNull(),
    gstMode: gstPriceMode('gst_mode'),
    /** The accepted offer's terms; never change. */
    pricePerUnitPaise: bigint('price_per_unit_paise', { mode: 'number' }).notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull(),
    status: dealStatus('status').notNull().default('agreed'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedByUserId: uuid('accepted_by_user_id')
      .notNull()
      .references(() => users.id),
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    handedOverByUserId: uuid('handed_over_by_user_id').references(() => users.id),
    handoverPhotoKey: text('handover_photo_key'),
    /** ≤ 300, masked per reader. */
    handoverNote: text('handover_note'),
    /** Set at handover and on a resume (R18, R21). */
    problemDeadlineAt: timestamp('problem_deadline_at', { withTimezone: true }),
    autoCompleteAt: timestamp('auto_complete_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedHow: dealCompletedHow('completed_how'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBySide: dealCancelledBy('cancelled_by_side'),
    /** `DEAL_CANCEL_REASONS_*`. */
    cancelReason: text('cancel_reason'),
    cancelNote: text('cancel_note'),
    /** A pending cancel request after handover (§9.5). */
    cancelRequestedSide: partySide('cancel_requested_side'),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelRequestedReason: text('cancel_requested_reason'),
    cancelRequestedByUserId: uuid('cancel_requested_by_user_id').references(() => users.id),
    /** Notes (R17): either side's non-viewer edits them while `agreed` / `handed_over`. */
    paymentMethod: dealPaymentMethod('payment_method'),
    /** CHECK 0 ≤ advance ≤ total (custom migration). */
    advancePaise: bigint('advance_paise', { mode: 'bigint' }),
    fulfilment: dealFulfilment('fulfilment'),
    expectedOn: date('expected_on'),
    /** ≤ 500, masked per reader; never shown to admins (§16.1). */
    notesText: text('notes_text'),
    /** §6.7: the notes text carries a payment phrase or handle (decided at write time). */
    notesScamFlag: boolean('notes_scam_flag').notNull().default(false),
    notesUpdatedAt: timestamp('notes_updated_at', { withTimezone: true }),
    notesUpdatedByUserId: uuid('notes_updated_by_user_id').references(() => users.id),
    /** +1 on every change; only a notes edit sends it back (`409 DEAL_STALE`). */
    version: integer('version').notNull().default(1),
    /** Last "still to hand over?" nudge (§9.3). */
    agreedRemindedAt: timestamp('agreed_reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    buyerStatusIdx: index('deals_buyer_status_updated_idx').on(t.buyerBusinessId, t.status, t.updatedAt.desc()),
    sellerStatusIdx: index('deals_seller_status_updated_idx').on(t.sellerBusinessId, t.status, t.updatedAt.desc()),
    handedOverDueIdx: index('deals_handed_over_due_idx')
      .on(t.status, t.autoCompleteAt)
      .where(sql`${t.status} = 'handed_over'`),
    openPerListingIdx: index('deals_open_per_listing_idx')
      .on(t.listingId)
      .where(sql`${t.status} IN ('agreed', 'handed_over', 'disputed')`),
    threadIdx: index('deals_thread_idx').on(t.threadId),
  }),
);

/**
 * Messages (§5.2): never edited or deleted. Written only by `services/chat/thread-lines.ts`. CHECK
 * `chat_messages_shape` (per kind) and `chat_messages_photos_max` in the custom migration.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    /** Global order; pages and unread use it. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    kind: messageKind('kind').notNull(),
    /** Null for `system`. */
    senderSide: partySide('sender_side'),
    senderUserId: uuid('sender_user_id').references(() => users.id),
    /** ≤ 2 000 (text, photo caption), ≤ 500 (enquiry note). Stored as written. */
    text: text('text'),
    quickOptions: text('quick_options').array().$type<QuickEnquiry[]>(),
    enquiryQuantity: numeric('enquiry_quantity', { precision: 14, scale: 3 }),
    /** Snapshot of the buyer's Check my machine choice with the verdict at send time. */
    fitMachine: jsonb('fit_machine').$type<EnquiryMachine>(),
    /** ≤ 5 final private keys (§6.8). */
    photoKeys: text('photo_keys').array().$type<string[]>(),
    offerId: uuid('offer_id').references(() => offers.id),
    dealId: uuid('deal_id').references(() => deals.id),
    systemCode: text('system_code').$type<SystemLineCode>(),
    systemValues: jsonb('system_values').$type<Record<string, string | number>>(),
    /** R7, decided at insert. */
    scamFlag: boolean('scam_flag').notNull().default(false),
    /** The app's id for a retried send. */
    clientMessageId: uuid('client_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadSeqIdx: index('chat_messages_thread_seq_idx').on(t.threadId, t.seq.desc()),
    clientIdUq: uniqueIndex('chat_messages_client_id_uq').on(t.senderUserId, t.clientMessageId),
  }),
);

/** Per-user thread state (§5.3): read position and archive. */
export const chatThreadUserState = pgTable(
  'chat_thread_user_state',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: 'chat_thread_user_state_pk', columns: [t.threadId, t.userId] }),
    userIdx: index('chat_thread_user_state_user_idx').on(t.userId),
  }),
);

/** A block between two businesses (§6.11). */
export const businessBlocks = pgTable(
  'business_blocks',
  {
    blockerBusinessId: uuid('blocker_business_id')
      .notNull()
      .references(() => businesses.id),
    blockedBusinessId: uuid('blocked_business_id')
      .notNull()
      .references(() => businesses.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: 'business_blocks_pk', columns: [t.blockerBusinessId, t.blockedBusinessId] }),
    blockedIdx: index('business_blocks_blocked_idx').on(t.blockedBusinessId),
  }),
);

/**
 * Share-my-number consents (§5.5, DPDP): append-only (trigger `contact_share_consents_append_only`, custom
 * migration; only a transaction that ran `SET LOCAL mpm.consent_purge = 'on'` may delete). `thread_id` null on a
 * business-wide `withdraw`.
 */
export const contactShareConsents = pgTable(
  'contact_share_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: consentKind('kind').notNull(),
    threadId: uuid('thread_id').references(() => chatThreads.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    /** Null for a withdraw the system writes. */
    userId: uuid('user_id').references(() => users.id),
    /** E.164: the number granted or withdrawn. */
    phoneShown: text('phone_shown').notNull(),
    /** `CONSENT_PHONE_SOURCES`. */
    phoneSource: text('phone_source').$type<ConsentPhoneSource>().notNull(),
    wordingVersion: smallint('wording_version').notNull(),
    /** `CONSENT_WITHDRAW_REASONS` on a withdraw. */
    reason: text('reason').$type<ConsentWithdrawReason>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadBusinessIdx: index('contact_share_consents_thread_business_idx').on(t.threadId, t.businessId, t.createdAt.desc()),
    businessPhoneIdx: index('contact_share_consents_business_phone_idx').on(t.businessId, t.phoneShown, t.createdAt.desc()),
  }),
);

/** A deal's stock hold (§5.7, R16): the deal is inserted first, then its hold. Written only by `holds.ts`. */
export const stockHolds = pgTable(
  'stock_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    dealId: uuid('deal_id')
      .notNull()
      .unique()
      .references(() => deals.id),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    status: holdStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => ({
    activeListingIdx: index('stock_holds_active_listing_idx').on(t.listingId).where(sql`${t.status} = 'active'`),
  }),
);

/** The deal timeline (§5.9); each event also posts a system line in the thread. */
export const dealEvents = pgTable(
  'deal_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    code: text('code').$type<DealEventCode>().notNull(),
    actorSide: dealActorSide('actor_side').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id),
    values: jsonb('values').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ dealCreatedIdx: index('deal_events_deal_created_idx').on(t.dealId, t.createdAt) }),
);

/** Problems reported on a deal (§5.10, §9.6): the businesses' dispute history. One open per deal. */
export const dealDisputes = pgTable(
  'deal_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    openedBySide: partySide('opened_by_side').notNull(),
    openedByUserId: uuid('opened_by_user_id')
      .notNull()
      .references(() => users.id),
    /** `DISPUTE_CATEGORIES`. */
    category: text('category').$type<DisputeCategory>().notNull(),
    /** 10–1 000, masked to the other party. */
    description: text('description').notNull(),
    /** ≤ 5 final private keys (CHECK `deal_disputes_photos_max`). */
    photoKeys: text('photo_keys').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    status: disputeStatus('status').notNull().default('open'),
    outcome: disputeOutcome('outcome'),
    /** ≤ 500, shown in the thread's `deal_dispute_resolved` line. */
    messageToParties: text('message_to_parties'),
    /** Audit only. */
    internalNote: text('internal_note'),
    resolvedByAdminId: uuid('resolved_by_admin_id').references(() => adminUsers.id),
    /** Asked when support closes as cancelled (§9.6). */
    stockReturned: boolean('stock_returned'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneOpen: uniqueIndex('deal_disputes_one_open').on(t.dealId).where(sql`${t.status} = 'open'`),
    queueIdx: index('deal_disputes_status_created_idx').on(t.status, t.createdAt),
  }),
);

/**
 * Reviews (§5.11, §10): one per side of a completed deal, published blind. CHECK `deal_reviews_shape` (facets per side,
 * 1–5, seller-side text null) in the custom migration.
 */
export const dealReviews = pgTable(
  'deal_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    /** `buyer` reviews the seller; `seller` reviews the buyer. */
    reviewerSide: partySide('reviewer_side').notNull(),
    reviewerBusinessId: uuid('reviewer_business_id')
      .notNull()
      .references(() => businesses.id),
    reviewedBusinessId: uuid('reviewed_business_id')
      .notNull()
      .references(() => businesses.id),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    rMatchedListing: smallint('r_matched_listing'),
    rCommunication: smallint('r_communication'),
    rOnTime: smallint('r_on_time'),
    rPayment: smallint('r_payment'),
    rPickup: smallint('r_pickup'),
    /** ≤ 1 000; buyer side only. */
    text: text('text'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    publishDueAt: timestamp('publish_due_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    hiddenByAdminId: uuid('hidden_by_admin_id').references(() => adminUsers.id),
    hiddenReason: text('hidden_reason'),
    /** The seller's one reply to a buyer → seller review (≤ 300). */
    replyText: text('reply_text'),
    replyUserId: uuid('reply_user_id').references(() => users.id),
    replyAt: timestamp('reply_at', { withTimezone: true }),
    replyHiddenAt: timestamp('reply_hidden_at', { withTimezone: true }),
  },
  (t) => ({
    dealSideUq: uniqueIndex('deal_reviews_deal_side_uq').on(t.dealId, t.reviewerSide),
    publishedVisibleIdx: index('deal_reviews_published_visible_idx')
      .on(t.reviewedBusinessId, t.reviewerSide)
      .where(sql`${t.publishedAt} IS NOT NULL AND ${t.hiddenAt} IS NULL`),
    unpublishedIdx: index('deal_reviews_unpublished_idx').on(t.publishDueAt).where(sql`${t.publishedAt} IS NULL`),
  }),
);

/** A user's push devices (§5.13, §11.6): one account per install. */
export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    installId: text('install_id').notNull().unique(),
    fcmToken: text('fcm_token').notNull(),
    platform: devicePlatform('platform').notNull(),
    appVersion: text('app_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('user_devices_user_idx').on(t.userId) }),
);

/**
 * In-app notifications (§5.13, §11), written in the change's transaction (`services/notifications/notify.ts`). Params
 * hold ids and safe values only. One unread grouped chat row per thread and user (`notifications_open_chat_row`).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    type: text('type').$type<NotificationType>().notNull(),
    category: notificationCategory('category').notNull(),
    params: jsonb('params').$type<Record<string, string | number | null>>().notNull().default({}),
    threadId: uuid('thread_id').references(() => chatThreads.id),
    offerId: uuid('offer_id').references(() => offers.id),
    dealId: uuid('deal_id').references(() => deals.id),
    reviewId: uuid('review_id').references(() => dealReviews.id),
    /** `<type>:<entityId>[:<qualifier>]`; unique per user, so a repeat is a no-op. */
    dedupeKey: text('dedupe_key').notNull(),
    /** Grouped chat rows: messages since the row opened. */
    unreadCount: smallint('unread_count').notNull().default(1),
    /** Grouped chat rows: the newest message's seq. */
    lastSeq: bigint('last_seq', { mode: 'number' }),
    /** Push delivery key `<id>:<version>`: an update re-sends and replaces the shown notification. */
    version: integer('version').notNull().default(1),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDedupeUq: uniqueIndex('notifications_user_dedupe_uq').on(t.userId, t.dedupeKey),
    userCreatedIdx: index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    unreadIdx: index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} IS NULL`),
    openChatRow: uniqueIndex('notifications_open_chat_row')
      .on(t.userId, t.threadId)
      .where(sql`${t.type} = 'message_new' AND ${t.readAt} IS NULL`),
  }),
);

/** Push deliveries (§5.13, §11.5): one per notification version and device; at-least-once with backoff. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => userDevices.id, { onDelete: 'cascade' }),
    state: deliveryState('state').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    notificationVersionDeviceUq: uniqueIndex('notification_deliveries_uq').on(t.notificationId, t.version, t.deviceId),
    stateDueIdx: index('notification_deliveries_state_due_idx').on(t.state, t.nextAttemptAt),
  }),
);

/**
 * Stored replies of idempotent routes (§5.14, P11). Committed with the business change in one transaction; "still
 * running" is a concurrent transaction holding the key's advisory lock. Deleted after 24 h. Never logged (§19).
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /** `<routeId>:<userId>`. */
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: smallint('status_code').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: 'idempotency_keys_pk', columns: [t.scope, t.key] }),
    createdIdx: index('idempotency_keys_created_idx').on(t.createdAt),
  }),
);
