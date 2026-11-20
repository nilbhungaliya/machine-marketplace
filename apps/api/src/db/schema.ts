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
  FRAUD_SIGNAL_KINDS, FRAUD_SIGNAL_STATUSES, type FraudEvidence,
  CONSENT_KINDS, DEAL_ACTOR_SIDES, DEAL_CANCELLED_BY, DEAL_COMPLETED_HOW, DEAL_FULFILMENT, DEAL_PAYMENT_METHODS, DEAL_STATUSES,
  DELIVERY_STATES, DEVICE_PLATFORMS, DISPUTE_OUTCOMES, DISPUTE_STATUSES, HOLD_STATUSES, MESSAGE_KINDS, NOTIFICATION_CATEGORIES,
  OFFER_KINDS, OFFER_STATUSES, PARTY_SIDES,
  PART_REQUEST_AUDIENCES, PART_REQUEST_CLOSE_REASONS, PART_REQUEST_DROP_REASONS, PART_REQUEST_FEEDBACK_REASONS,
  PART_REQUEST_KINDS, PART_REQUEST_MATCH_SOURCES, PART_REQUEST_MATCH_TIERS, PART_REQUEST_REACHES,
  PART_REQUEST_REPLY_STATUSES, PART_REQUEST_STATUSES, PART_REQUEST_WORK_KINDS,
  RENTAL_ACTOR_SIDES, RENTAL_BLOCK_REASONS, RENTAL_BOOKING_STATUSES, RENTAL_BOOKING_TURNS, RENTAL_COMPLETED_HOW,
  type RentalCancelReason, type RentalDeclineReason, type RentalDisputeCategory, type RentalEventCode, type RentalFinalReason,
  type RentalSystemReason, type RentalTermsSnapshot,
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
  /** Lowercase (CHECK `admin_users_email_lower`, 0019). */
  email: text('email').notNull().unique(),
  /** Null while an invite or reset link is out (admin close-out §5.1): login refuses it with the generic error. */
  passwordHash: text('password_hash'),
  role: adminRole('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  /** Admin close-out R13: a token carries it as `tv`; +1 ends every session of the admin. */
  tokenVersion: integer('token_version').notNull().default(0),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  deactivatedByAdminId: uuid('deactivated_by_admin_id').references((): AnyPgColumn => adminUsers.id),
  createdByAdminId: uuid('created_by_admin_id').references((): AnyPgColumn => adminUsers.id),
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
    // Admin close-out §5.6: the dashboard's new businesses.
    createdIdx: index('businesses_created_idx').on(t.createdAt),
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
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null means System (admin close-out §5.5). */
    adminId: uuid('admin_id').references(() => adminUsers.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Admin close-out §5.5: the audit log viewer's order and filters.
  (t) => ({
    createdIdx: index('audit_log_created_idx').on(t.createdAt.desc(), t.id.desc()),
    entityIdx: index('audit_log_entity_idx').on(t.entityType, t.entityId),
    adminCreatedIdx: index('audit_log_admin_created_idx').on(t.adminId, t.createdAt.desc()),
  }),
);

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
    // Admin close-out (wave A fix): the dashboard's new listings.
    firstLiveIdx: index('listings_first_live_idx').on(t.firstLiveAt).where(sql`${t.firstLiveAt} IS NOT NULL`),
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
  (t) => ({
    listingCreatedIdx: index('listing_status_history_listing_created_idx').on(t.listingId, t.createdAt),
    // Admin close-out §5.6: the dashboard's sold / closed listings.
    toStatusCreatedIdx: index('listing_status_history_to_status_created_idx').on(t.toStatus, t.createdAt),
  }),
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
    // Admin close-out §5.6: the dashboard's enquiries.
    createdIdx: index('chat_threads_created_idx').on(t.createdAt),
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
    // Admin close-out §5.6: the dashboard's offers (opening rows only).
    openingCreatedIdx: index('offers_opening_created_idx').on(t.createdAt).where(sql`${t.round} = 0`),
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
    // Admin close-out §5.6: the dashboard's deals and their value.
    acceptedIdx: index('deals_accepted_idx').on(t.acceptedAt),
    // Admin close-out (wave A fix): the dashboard's deals completed.
    completedIdx: index('deals_completed_idx').on(t.completedAt).where(sql`${t.completedAt} IS NOT NULL`),
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
    /** M14 §8: a `booking` card's booking (CHECK `chat_messages_shape`, 0017). */
    rentalBookingId: uuid('rental_booking_id').references((): AnyPgColumn => rentalBookings.id),
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
    // Admin close-out §5.4: the fraud scan reads messages past its `seq` watermark.
    seqIdx: index('chat_messages_seq_idx').on(t.seq),
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

/**
 * Problems reported on a deal (§5.10, §9.6) or, since M14 (R12), on a rental booking: exactly one of `deal_id` /
 * `rental_booking_id` (CHECK `deal_disputes_subject_one`, 0017). One open per deal and one per booking.
 */
export const dealDisputes = pgTable(
  'deal_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id').references(() => deals.id),
    rentalBookingId: uuid('rental_booking_id').references((): AnyPgColumn => rentalBookings.id),
    openedBySide: partySide('opened_by_side').notNull(),
    openedByUserId: uuid('opened_by_user_id')
      .notNull()
      .references(() => users.id),
    /** `DISPUTE_CATEGORIES`; `RENTAL_DISPUTE_CATEGORIES` on a booking. */
    category: text('category').$type<DisputeCategory | RentalDisputeCategory>().notNull(),
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
    oneOpenDeal: uniqueIndex('deal_disputes_one_open_deal')
      .on(t.dealId)
      .where(sql`${t.status} = 'open' AND ${t.dealId} IS NOT NULL`),
    oneOpenRental: uniqueIndex('deal_disputes_one_open_rental')
      .on(t.rentalBookingId)
      .where(sql`${t.status} = 'open' AND ${t.rentalBookingId} IS NOT NULL`),
    queueIdx: index('deal_disputes_status_created_idx').on(t.status, t.createdAt),
  }),
);

/**
 * Reviews (§5.11, §10): one per side of a completed deal or (M14 R11) rental booking, published blind; exactly one of
 * `deal_id` / `rental_booking_id` (CHECK `deal_reviews_subject_one`, 0017). CHECK `deal_reviews_shape` (facets per
 * subject and side, 1–5, seller-side text null) in the custom migrations.
 */
export const dealReviews = pgTable(
  'deal_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id').references(() => deals.id),
    rentalBookingId: uuid('rental_booking_id').references((): AnyPgColumn => rentalBookings.id),
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
    /** M14 R11: the owner rates the renter's care of the machine (rental seller side only). */
    rCare: smallint('r_care'),
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
    rentalSideUq: uniqueIndex('deal_reviews_rental_side_uq')
      .on(t.rentalBookingId, t.reviewerSide)
      .where(sql`${t.rentalBookingId} IS NOT NULL`),
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
    /** F8 §5.9: the part request a `part_*` row opens. */
    partRequestId: uuid('part_request_id').references((): AnyPgColumn => partRequests.id),
    /** M14 §11: the rental booking a `rental_booking_*` (or a rental review) row opens. */
    rentalBookingId: uuid('rental_booking_id').references((): AnyPgColumn => rentalBookings.id),
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
    // F8 §10.2: one unread grouped row per request, type and user (`upsertRequestNotification`).
    openRequestRow: uniqueIndex('notifications_open_request_row')
      .on(t.userId, t.partRequestId, t.type)
      .where(sql`${t.type} IN ('part_match', 'part_request_reply') AND ${t.readAt} IS NULL`),
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

// ─── F8: part requests, seller targeting and availability alerts (spec 2026-11-20-f8-part-requests §5) ───
// Every index is declared here (partial ones with `.where`), so drizzle-kit emits them into the generated migration.
// What drizzle-kit 0.22 can't emit is in the custom migration that follows it: the CHECKs and
// `part_requests_ref_seq` restarted at 300001. No migration statement uses the enum values this migration adds to
// existing enums (`notification_category` 'requests', `report_target` 'part_request', §5.10). No ON DELETE CASCADE:
// test cleanup (`deleteF8Rows`) deletes in FK order.

export const partRequestKind = pgEnum('part_request_kind', PART_REQUEST_KINDS);
export const partRequestStatus = pgEnum('part_request_status', PART_REQUEST_STATUSES);
export const partRequestReach = pgEnum('part_request_reach', PART_REQUEST_REACHES);
export const partRequestAudience = pgEnum('part_request_audience', PART_REQUEST_AUDIENCES);
export const partRequestCloseReason = pgEnum('part_request_close_reason', PART_REQUEST_CLOSE_REASONS);
export const partRequestReplyStatus = pgEnum('part_request_reply_status', PART_REQUEST_REPLY_STATUSES);
export const partRequestDropReason = pgEnum('part_request_drop_reason', PART_REQUEST_DROP_REASONS);
export const partRequestMatchTier = pgEnum('part_request_match_tier', PART_REQUEST_MATCH_TIERS);
export const partRequestMatchSource = pgEnum('part_request_match_source', PART_REQUEST_MATCH_SOURCES);
export const partRequestFeedbackReason = pgEnum('part_request_feedback_reason', PART_REQUEST_FEEDBACK_REASONS);
export const partRequestWorkKind = pgEnum('part_request_work_kind', PART_REQUEST_WORK_KINDS);

/**
 * A buyer business's requirement (§5.1). `status` is written only by `services/part-requests/lifecycle.ts`
 * (`writeRequestStatus`); never locked `FOR UPDATE` (§9.5). Location columns are a snapshot of the business location,
 * refreshed on every edit; never shown as coordinates or pincode.
 */
export const partRequests = pgTable(
  'part_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Shown as "Requirement #300001" (the custom migration restarts the sequence at 300001). */
    ref: bigserial('ref', { mode: 'number' }).notNull().unique(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    kind: partRequestKind('kind').notNull(),
    status: partRequestStatus('status').notNull().default('active'),
    /** Where an admin restore goes (§9.1). */
    returnStatus: partRequestStatus('return_status'),
    /** Parts: a part group or a machine type; machines: a machine type. */
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    /** `normalizePartName(name)` (side words dropped), for `pg_trgm`. */
    nameNorm: text('name_norm').notNull(),
    partNumber: text('part_number'),
    partNumberNorm: text('part_number_norm'),
    partNumberBase: text('part_number_base'),
    /** Left / Right / Pair where the node has sides; null otherwise and for machines (CHECK). */
    side: partSide('side'),
    specs: jsonb('specs').$type<Specs>().notNull().default({}),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    /** Empty = any condition. */
    conditionIds: uuid('condition_ids').array().notNull().default(sql`'{}'::uuid[]`),
    budgetPerUnitPaise: bigint('budget_per_unit_paise', { mode: 'number' }),
    budgetVisible: boolean('budget_visible').notNull().default(false),
    neededBy: date('needed_by'),
    urgent: boolean('urgent').notNull().default(false),
    reach: partRequestReach('reach').notNull().default('radius_200'),
    audience: partRequestAudience('audience').notNull().default('verified_only'),
    point: geography('point'),
    pincode: text('pincode'),
    city: text('city'),
    state: text('state'),
    industrialAreaId: uuid('industrial_area_id').references(() => industrialAreas.id),
    industrialAreaOther: text('industrial_area_other'),
    /** Private `part-request/<id>/<uuid>.jpg` keys; CHECK at most 3. */
    photoKeys: text('photo_keys').array().notNull().default(sql`'{}'::text[]`),
    note: text('note'),
    noteFlagged: boolean('note_flagged').notNull().default(false),
    /** +1 on every edit; `PATCH` sends it back (`PART_REQUEST_STALE`). */
    version: integer('version').notNull().default(1),
    validityDays: smallint('validity_days').notNull(),
    firstPostedAt: timestamp('first_posted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    expiringNotifiedAt: timestamp('expiring_notified_at', { withTimezone: true }),
    closeReason: partRequestCloseReason('close_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    fulfilledDealId: uuid('fulfilled_deal_id').references(() => deals.id),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedByAdminId: uuid('removed_by_admin_id').references(() => adminUsers.id),
    removedReason: text('removed_reason'),
    /** Targeting passes done (§7.3). */
    targetPass: smallint('target_pass').notNull().default(0),
    targetedAt: timestamp('targeted_at', { withTimezone: true }),
    /** Auto-match push caps (§7.5), IST day. */
    matchPushDay: date('match_push_day'),
    matchPushDayCount: smallint('match_push_day_count').notNull().default(0),
    matchPushTotal: smallint('match_push_total').notNull().default(0),
    /** Last time a buyer member opened the request (`POST /part-requests/:id/read`): Home's "new" count (review Q6). */
    buyerSeenAt: timestamp('buyer_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    businessStatusCreatedIdx: index('part_requests_business_status_created_idx').on(
      t.businessId,
      t.status,
      t.createdAt.desc(),
    ),
    activeKindCategoryIdx: index('part_requests_active_kind_category_idx')
      .on(t.kind, t.categoryId)
      .where(sql`${t.status} = 'active'`),
    activeExpiresIdx: index('part_requests_active_expires_idx').on(t.expiresAt).where(sql`${t.status} = 'active'`),
    activePointIdx: index('part_requests_active_point_idx').using('gist', t.point).where(sql`${t.status} = 'active'`),
    statusCreatedIdx: index('part_requests_status_created_idx').on(t.status, t.createdAt.desc()),
    // Admin close-out §5.6: the dashboard's requirements posted.
    firstPostedIdx: index('part_requests_first_posted_idx').on(t.firstPostedAt),
    // Admin close-out (wave A fix): the dashboard's fulfilment median.
    fulfilledIdx: index('part_requests_fulfilled_idx').on(t.fulfilledAt).where(sql`${t.fulfilledAt} IS NOT NULL`),
  }),
);

/** A request's "fits" rows (§5.2): brand, model, years; at most 5 (code). CHECK from <= to (custom migration). */
export const partRequestFitments = pgTable(
  'part_request_fitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partRequestId: uuid('part_request_id')
      .notNull()
      .references(() => partRequests.id),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id),
    modelId: uuid('model_id').references(() => machineModels.id),
    yearFrom: smallint('year_from'),
    yearTo: smallint('year_to'),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => ({ requestIdx: index('part_request_fitments_request_idx').on(t.partRequestId) }),
);

/** The notified set (§5.3, R7): computed once per pass, never re-notified. */
export const partRequestTargets = pgTable(
  'part_request_targets',
  {
    partRequestId: uuid('part_request_id')
      .notNull()
      .references(() => partRequests.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    score: numeric('score', { precision: 6, scale: 2 }).notNull(),
    rank: smallint('rank').notNull(),
    pass: smallint('pass').notNull(),
    bestListingId: uuid('best_listing_id').references(() => listings.id),
    pushed: boolean('pushed').notNull().default(false),
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull().defaultNow(),
    /** A member of the seller business opened the request (the badge). */
    openedAt: timestamp('opened_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ name: 'part_request_targets_pk', columns: [t.partRequestId, t.businessId] }),
    businessNotifiedIdx: index('part_request_targets_business_notified_idx').on(t.businessId, t.notifiedAt.desc()),
  }),
);

/** A seller's reply: always one of its listings (§5.4, R2). Message at most 300 (CHECK), masked on read. */
export const partRequestReplies = pgTable(
  'part_request_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partRequestId: uuid('part_request_id')
      .notNull()
      .references(() => partRequests.id),
    sellerBusinessId: uuid('seller_business_id')
      .notNull()
      .references(() => businesses.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    message: text('message'),
    messageFlagged: boolean('message_flagged').notNull().default(false),
    status: partRequestReplyStatus('status').notNull(),
    dropReason: partRequestDropReason('drop_reason'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    droppedAt: timestamp('dropped_at', { withTimezone: true }),
    buyerViewedAt: timestamp('buyer_viewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestListingUq: uniqueIndex('part_request_replies_request_listing_uq').on(t.partRequestId, t.listingId),
    requestStatusIdx: index('part_request_replies_request_status_idx').on(t.partRequestId, t.status),
    pendingListingIdx: index('part_request_replies_pending_listing_idx')
      .on(t.listingId)
      .where(sql`${t.status} = 'pending'`),
    sellerCreatedIdx: index('part_request_replies_seller_created_idx').on(t.sellerBusinessId, t.createdAt),
  }),
);

/** Auto matches (§5.5, R8): one per request and listing; `distance_km` snapped whole km. */
export const partRequestMatches = pgTable(
  'part_request_matches',
  {
    partRequestId: uuid('part_request_id')
      .notNull()
      .references(() => partRequests.id),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    sellerBusinessId: uuid('seller_business_id')
      .notNull()
      .references(() => businesses.id),
    tier: partRequestMatchTier('tier').notNull(),
    distanceKm: integer('distance_km'),
    source: partRequestMatchSource('source').notNull(),
    pushed: boolean('pushed').notNull().default(false),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: 'part_request_matches_pk', columns: [t.partRequestId, t.listingId] }),
    listingIdx: index('part_request_matches_listing_idx').on(t.listingId),
  }),
);

/** "Not relevant" (§5.6): hides the request from that business's lists; kept as feedback. */
export const partRequestFeedback = pgTable(
  'part_request_feedback',
  {
    partRequestId: uuid('part_request_id')
      .notNull()
      .references(() => partRequests.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    reason: partRequestFeedbackReason('reason'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ name: 'part_request_feedback_pk', columns: [t.partRequestId, t.businessId] }) }),
);

/**
 * The F8 work queue (§5.7, §8): writers `INSERT ... ON CONFLICT DO NOTHING` on the unclaimed-row unique index (never
 * waiting on the job); the `part-request-work` job claims, processes each row in its own transaction, retries, and
 * dead-letters (`failed_at`) after 5 attempts. `last_error` holds an error code, never data.
 */
export const partRequestWork = pgTable(
  'part_request_work',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: partRequestWorkKind('kind').notNull(),
    /** The request (`target_request`) or the listing (`listing_changed`). */
    subjectId: uuid('subject_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (t) => ({
    unclaimedUq: uniqueIndex('part_request_work_unclaimed_uq')
      .on(t.kind, t.subjectId)
      .where(sql`${t.claimedAt} IS NULL`),
    dueIdx: index('part_request_work_due_idx').on(t.nextAttemptAt).where(sql`${t.claimedAt} IS NULL`),
    claimedIdx: index('part_request_work_claimed_idx')
      .on(t.claimedAt)
      .where(sql`${t.doneAt} IS NULL AND ${t.failedAt} IS NULL AND ${t.claimedAt} IS NOT NULL`),
  }),
);

/** The per-seller daily push cap (§5.8, §7.5): one atomic upsert per pass; IST day. */
export const partRequestPushCounts = pgTable(
  'part_request_push_counts',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    day: date('day').notNull(),
    pushes: smallint('pushes').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ name: 'part_request_push_counts_pk', columns: [t.businessId, t.day] }) }),
);

// ─── M14 rental bookings (spec 2026-11-20-m14-rental-bookings §5) ───
// CHECKs, the reference sequence (#700001) and the text-cast `chat_messages_shape` are in 0017 (custom). Nothing in
// 0016 / 0017 compares `message_kind` 'booking' or `notification_category` 'rentals' as enum literals (the migrator
// runs every pending migration in one transaction; a new value of an existing enum can't be used there).

export const rentalBookingStatus = pgEnum('rental_booking_status', RENTAL_BOOKING_STATUSES);
export const rentalBookingTurn = pgEnum('rental_booking_turn', RENTAL_BOOKING_TURNS);
export const rentalCompletedHow = pgEnum('rental_completed_how', RENTAL_COMPLETED_HOW);
export const rentalActorSide = pgEnum('rental_actor_side', RENTAL_ACTOR_SIDES);
export const rentalBlockReason = pgEnum('rental_block_reason', RENTAL_BLOCK_REASONS);

/**
 * A rental booking (§5.1): the renter's request → the owner's answer → on site → returned → completed. `status` is
 * written only by `services/rentals/booking-write.ts` (`writeBookingStatus`). The booking is inserted first, then
 * version 1, then `current_version_id` is set (the two tables reference each other). Capacity reads `start_date` /
 * `end_date` / `machines`, copied from the open or agreed version.
 */
export const rentalBookings = pgTable(
  'rental_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Shown as #700001… (0017 restarts the sequence). */
    ref: bigserial('ref', { mode: 'number' }).notNull().unique(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    /** The listing's F6 thread with the renter business (opened by the request if none). */
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    renterBusinessId: uuid('renter_business_id')
      .notNull()
      .references(() => businesses.id),
    /** The listing's business at request time. */
    ownerBusinessId: uuid('owner_business_id')
      .notNull()
      .references(() => businesses.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    status: rentalBookingStatus('status').notNull().default('requested'),
    /** Whose answer the open proposal waits for; set iff `requested` / `countered` (CHECK). */
    turn: rentalBookingTurn('turn'),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => rentalBookingVersions.id),
    /** Proposals after the first (R3 cap `rental_max_changes`). */
    changeCount: smallint('change_count').notNull().default(0),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    period: rentalPeriod('period').notNull(),
    periodCount: smallint('period_count').notNull(),
    machines: smallint('machines').notNull(),
    withOperator: boolean('with_operator').notNull(),
    ownerDelivers: boolean('owner_delivers').notNull(),
    /** Set at confirm / accept-change. */
    agreedTotalPaise: bigint('agreed_total_paise', { mode: 'number' }),
    /** Set at return (R6). */
    finalAmountPaise: bigint('final_amount_paise', { mode: 'number' }),
    finalAmountReason: text('final_amount_reason').$type<RentalFinalReason>(),
    /** ≤ 300, masked per reader. */
    finalAmountNote: text('final_amount_note'),
    sitePincode: text('site_pincode').notNull(),
    siteCity: text('site_city').notNull(),
    siteState: text('site_state').notNull(),
    /** ≤ 200; renter always, owner only from `confirmed` on and masked until the reveal (§8). */
    siteAddress: text('site_address'),
    /** The pincode's centroid; for distance only, never served. */
    sitePoint: geography('site_point'),
    listingTitle: text('listing_title').notNull(),
    /** The listing's rates and terms at request. */
    termsSnapshot: jsonb('terms_snapshot').$type<RentalTermsSnapshot>().notNull(),
    replyDueAt: timestamp('reply_due_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    onSiteAt: timestamp('on_site_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** `renter` / `owner` only (CHECK). */
    onSiteBySide: rentalActorSide('on_site_by_side'),
    hourMeterStart: integer('hour_meter_start'),
    hourMeterEnd: integer('hour_meter_end'),
    /** ≤ 3 private keys each (`rental/<id>/…`, CHECK). */
    onSitePhotoKeys: text('on_site_photo_keys').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    returnPhotoKeys: text('return_photo_keys').array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    /** ≤ 500, masked per reader. */
    damageNote: text('damage_note'),
    /** `returned_at + rental_complete_days`. */
    autoCompleteAt: timestamp('auto_complete_at', { withTimezone: true }),
    completedHow: rentalCompletedHow('completed_how'),
    cancelledBySide: rentalActorSide('cancelled_by_side'),
    cancelReason: text('cancel_reason').$type<RentalCancelReason>(),
    /** ≤ 300, masked per reader. */
    cancelNote: text('cancel_note'),
    /** The owner's (or the renter's, of a change) reason, or a system exit's. */
    declineReason: text('decline_reason').$type<RentalDeclineReason | RentalSystemReason>(),
    /** `on_rent` or `returned` while `disputed` (capacity and resume; CHECK). */
    disputedFrom: rentalBookingStatus('disputed_from'),
    /** Notes (R10): recorded, paid outside the app. */
    paymentMethod: dealPaymentMethod('payment_method'),
    /** CHECK ≤ agreed total. */
    advancePaise: bigint('advance_paise', { mode: 'number' }),
    depositPaise: bigint('deposit_paise', { mode: 'number' }),
    depositReturned: boolean('deposit_returned'),
    /** `HH:MM`. */
    expectedOnSiteTime: text('expected_on_site_time'),
    /** ≤ 500, masked per reader. */
    notesText: text('notes_text'),
    notesScamFlag: boolean('notes_scam_flag').notNull().default(false),
    notesUpdatedAt: timestamp('notes_updated_at', { withTimezone: true }),
    notesUpdatedByUserId: uuid('notes_updated_by_user_id').references(() => users.id),
    /** Each reminder once (§9). */
    startRemindedAt: timestamp('start_reminded_at', { withTimezone: true }),
    dueRemindedAt: timestamp('due_reminded_at', { withTimezone: true }),
    overdueRemindedAt: timestamp('overdue_reminded_at', { withTimezone: true }),
    notStartedRemindedAt: timestamp('not_started_reminded_at', { withTimezone: true }),
    /** +1 on every change; only a notes edit sends it back (`409 RENTAL_BOOKING_STALE`). */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    capacityIdx: index('rental_bookings_capacity_idx')
      .on(t.listingId, t.status, t.startDate, t.endDate)
      .where(sql`${t.status} IN ('confirmed', 'on_rent', 'disputed')`),
    renterStatusIdx: index('rental_bookings_renter_status_updated_idx').on(t.renterBusinessId, t.status, t.updatedAt.desc()),
    ownerStatusIdx: index('rental_bookings_owner_status_updated_idx').on(t.ownerBusinessId, t.status, t.updatedAt.desc()),
    replyDueIdx: index('rental_bookings_reply_due_idx')
      .on(t.status, t.replyDueAt)
      .where(sql`${t.status} IN ('requested', 'countered')`),
    autoCompleteIdx: index('rental_bookings_auto_complete_idx')
      .on(t.status, t.autoCompleteAt)
      .where(sql`${t.status} = 'returned'`),
    threadIdx: index('rental_bookings_thread_idx').on(t.threadId),
    listingIdx: index('rental_bookings_listing_idx').on(t.listingId),
    // Admin close-out §5.6: the dashboard's rental bookings and their value.
    confirmedIdx: index('rental_bookings_confirmed_idx').on(t.confirmedAt),
  }),
);

/** Every proposal of a booking (§5.2, R3): `seq` 1 = the request. Never updated. */
export const rentalBookingVersions = pgTable(
  'rental_booking_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => rentalBookings.id),
    seq: smallint('seq').notNull(),
    proposedBySide: rentalBookingTurn('proposed_by_side').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    period: rentalPeriod('period').notNull(),
    periodCount: smallint('period_count').notNull(),
    machines: smallint('machines').notNull(),
    withOperator: boolean('with_operator').notNull(),
    ownerDelivers: boolean('owner_delivers').notNull(),
    /** The server's estimate for these terms (R2). */
    estimatePaise: bigint('estimate_paise', { mode: 'number' }).notNull(),
    /** = estimate for a renter version; the owner's own total for an owner version (§6.3). */
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    /** ≤ 500 on the request, ≤ 300 after; masked per reader. */
    message: text('message'),
    /** §6.7: the message carries a payment phrase or handle (decided at write time). */
    messageScamFlag: boolean('message_scam_flag').notNull().default(false),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bookingSeqUq: uniqueIndex('rental_booking_versions_booking_seq_uq').on(t.bookingId, t.seq) }),
);

/** The booking timeline (§5.3, the `deal_events` pattern); `values` never carry text a user typed. */
export const rentalBookingEvents = pgTable(
  'rental_booking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => rentalBookings.id),
    code: text('code').$type<RentalEventCode>().notNull(),
    actorSide: rentalActorSide('actor_side').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id),
    values: jsonb('values').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bookingCreatedIdx: index('rental_booking_events_booking_created_idx').on(t.bookingId, t.createdAt) }),
);

/** An owner's calendar block (§5.4, R5): machines out of service or booked outside the app. Hard-deleted. */
export const rentalBlocks = pgTable(
  'rental_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    machines: smallint('machines').notNull(),
    reason: rentalBlockReason('reason').notNull(),
    /** ≤ 200; owner and admins only. */
    note: text('note'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ listingRangeIdx: index('rental_blocks_listing_range_idx').on(t.listingId, t.startDate, t.endDate) }),
);

// ─── Admin close-out (spec 2026-11-21-admin-close-out §5) ───
// CHECKs in the custom migration 0019 (drizzle-kit 0.22 cannot emit them).

/**
 * An invite or reset link (§5.2): only the SHA-256 hex of the token is stored. Issuing one sets `used_at` on the admin's
 * other unused links (newest wins). `purpose` is `invite` | `reset` (CHECK `admin_password_tokens_purpose`). Deleted 7
 * days after use or expiry.
 */
export const adminPasswordTokens = pgTable(
  'admin_password_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose').$type<'invite' | 'reset'>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ adminCreatedIdx: index('admin_password_tokens_admin_created_idx').on(t.adminId, t.createdAt) }),
);

export const fraudSignalKind = pgEnum('fraud_signal_kind', FRAUD_SIGNAL_KINDS);
export const fraudSignalStatus = pgEnum('fraud_signal_status', FRAUD_SIGNAL_STATUSES);

/**
 * An advisory fraud signal on a business (§5.3, §8): one open per business and kind; evidence ≤ 50 items (CHECK
 * `fraud_signals_evidence_shape`), `evidence_count` counts every item ever appended; `reviewed_at` set exactly when
 * closed (CHECK `fraud_signals_review_shape`). Never a raw phone, message text or install id.
 */
export const fraudSignals = pgTable(
  'fraud_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    kind: fraudSignalKind('kind').notNull(),
    status: fraudSignalStatus('status').notNull().default('open'),
    evidence: jsonb('evidence').$type<FraudEvidence[]>().notNull().default([]),
    evidenceCount: integer('evidence_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => adminUsers.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneOpen: uniqueIndex('fraud_signals_one_open').on(t.businessId, t.kind).where(sql`${t.status} = 'open'`),
    statusLastSeenIdx: index('fraud_signals_status_last_seen_idx').on(t.status, t.lastSeenAt.desc()),
    // A business's signals in any status (business detail, the rules' "after the latest close").
    businessKindIdx: index('fraud_signals_business_kind_idx').on(t.businessId, t.kind),
  }),
);

/**
 * Which accounts signed in on which app install (§5.4): `user_devices.install_id` moves to the latest user, so it can't
 * show history. `install_hash` is the SHA-256 hex of the `X-Install-Id`, never the value. Deleted after 90 days.
 */
export const installSightings = pgTable(
  'install_sightings',
  {
    installHash: text('install_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.installHash, t.userId] }),
    // The scan's watermark and the 90-day retention.
    lastSeenIdx: index('install_sightings_last_seen_idx').on(t.lastSeenAt),
    userIdx: index('install_sightings_user_idx').on(t.userId),
  }),
);

/**
 * A phone number seen in a chat message (§5.4), as HMAC-SHA-256 with `SIGNAL_HASH_KEY`, never the number. One row per
 * message and number (a re-scan inserts `ON CONFLICT DO NOTHING`). Deleted after 90 days.
 */
export const contactSightings = pgTable(
  'contact_sightings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    phoneHmac: text('phone_hmac').notNull(),
    /** The sender's business. */
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    phoneSeenIdx: index('contact_sightings_phone_seen_idx').on(t.phoneHmac, t.seenAt),
    businessSeenIdx: index('contact_sightings_business_seen_idx').on(t.businessId, t.seenAt),
    messagePhoneUq: uniqueIndex('contact_sightings_message_phone_uq').on(t.messageId, t.phoneHmac),
  }),
);

/**
 * The fraud scan's watermark per rule source (§5.4, R9a): `chat_messages` over `chat_messages.seq` (`last_seq`), the
 * others by time (`last_at`); exactly one set (CHECK `fraud_scan_state_one_mark`). A missing row means "start 30 days
 * back".
 */
export const fraudScanState = pgTable('fraud_scan_state', {
  rule: text('rule').primaryKey(),
  lastSeq: bigint('last_seq', { mode: 'number' }),
  lastAt: timestamp('last_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
