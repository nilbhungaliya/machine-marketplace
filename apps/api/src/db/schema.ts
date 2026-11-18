import {
  pgTable, uuid, text, timestamp, pgEnum, boolean, jsonb, customType, index, uniqueIndex, unique, integer, smallint,
  numeric, date, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  ACCOUNT_STATUSES, ADMIN_ROLES, CATALOG_LEVELS, CATALOG_STATUSES, EMPLOYEE_RANGES, FIELD_APPLIES_TO, FIELD_TYPES,
  GST_CHECK_RESULTS, GST_PROOF_STATUSES, GST_STATUSES, LANGUAGES, MEMBER_ROLES, VERIFICATION_LEVELS,
  VERIFICATION_STATUSES, type BusinessActivity, type GstDetails, type GstDocumentType,
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

export const users = pgTable('users', {
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
});

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

/** What the business typed on a review with no lookup attached (§5.3). */
export interface GstEnteredDetails {
  legalName: string;
  tradeName: string | null;
  address: GstDetails['address'];
  constitution: string;
}

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
