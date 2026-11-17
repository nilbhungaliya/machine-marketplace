import { pgTable, uuid, text, timestamp, pgEnum, boolean, jsonb, customType, index } from 'drizzle-orm/pg-core';
import {
  ADMIN_ROLES, BUSINESS_ROLES, LANGUAGES, MEMBER_ROLES, VERIFICATION_STATUSES,
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
