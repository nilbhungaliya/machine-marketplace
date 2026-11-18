import {
  pgTable, uuid, text, timestamp, pgEnum, boolean, jsonb, customType, index, uniqueIndex, unique, integer, smallint,
  numeric, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  ADMIN_ROLES, BUSINESS_ROLES, CATALOG_LEVELS, CATALOG_STATUSES, FIELD_APPLIES_TO, FIELD_TYPES, LANGUAGES, MEMBER_ROLES,
  VERIFICATION_STATUSES,
} from '@mpm/shared-types';

// Starting schema only: admin auth, the business/user core (scope F1, A2) and the audit log. Listings, enquiries,
// offers, deals, rental bookings and part requests are added per feature, then `pnpm --filter @mpm/api db:generate`.
// Never hand-edit or delete files in infra/migrations — always generate new ones.

/** PostGIS geography (SRID 4326 by default; store points only). Write with `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` in raw SQL. */
const geography = customType<{ data: string }>({ dataType: () => 'geography' });

export const adminRole = pgEnum('admin_role', ADMIN_ROLES);
export const businessRole = pgEnum('business_role', BUSINESS_ROLES);
export const memberRole = pgEnum('member_role', MEMBER_ROLES);
export const language = pgEnum('language', LANGUAGES);
export const verificationStatus = pgEnum('verification_status', VERIFICATION_STATUSES);
export const catalogLevel = pgEnum('catalog_level', CATALOG_LEVELS);
export const fieldType = pgEnum('field_type', FIELD_TYPES);
export const catalogStatus = pgEnum('catalog_status', CATALOG_STATUSES);
export const fieldAppliesTo = pgEnum('field_applies_to', FIELD_APPLIES_TO);
export const accountStatus = pgEnum('account_status', ['active', 'suspended', 'blocked']);

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

/** A business profile (scope F1). One account can buy and sell. */
export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: text('legal_name'),
    tradeName: text('trade_name').notNull(),
    gstin: text('gstin').unique(),
    pan: text('pan'),
    role: businessRole('role').notNull().default('both'),
    /** Location and industrial area (scope F1, F5: search by city / industrial area / state). */
    addressLine: text('address_line'),
    industrialArea: text('industrial_area'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    location: geography('location'),
    /** Machine categories the business deals in (category ids once A4 exists). */
    categories: jsonb('categories').$type<string[]>().notNull().default([]),
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
