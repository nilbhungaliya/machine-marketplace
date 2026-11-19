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
  type BusinessActivity, type DeliveryOption,
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
