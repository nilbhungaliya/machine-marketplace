import { and, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  normalizeGstin,
  type AccountStatus,
  type AdminBusinessDetail,
  type AdminBusinessList,
  type AdminBusinessRow,
  type MemberRole,
  type VerificationLevel,
  type VerificationStatus,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { adminUsers, auditLog, businessVerifications, businesses, gstRepresentativeProofs, listings, users } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { adminText } from '../../lib/admin-text.js';
import { writeAudit } from '../audit.service.js';
import { businessProfile } from '../business/profile.service.js';
import { businessDealHistory } from '../deals/deal-read.service.js';
import { sellerScore } from '../reviews/review-scores.js';
import { lockGstin } from '../verification/gst-grant.service.js';
import { gstHistory } from '../verification/gst-history.service.js';
import { getGstState, openReview } from '../verification/gst-state.service.js';

/**
 * Users & businesses for admins (F1 + A2 spec §5.4, §5.4a, §8.2; textile `verification.service.ts` `listBusinesses` /
 * `getBusiness` / `revokeVerification`). Reads for support, verification officers and moderators; Revoke GST and
 * Release GSTIN for verification officers. Every action writes one `audit_log` row (entity `business`).
 */

export const PAGE_SIZE_MAX = 100;
const AUDIT_LIMIT = 50;

export interface BusinessListQuery {
  search?: string;
  city?: string;
  industrialAreaId?: string;
  verification?: VerificationStatus;
  /** The owner's account status. */
  status?: AccountStatus;
  page: number;
  pageSize: number;
}

/** `%`, `_` and `\` match themselves. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The business's owner (the first owner, else its first user). */
const OWNER_JOIN = sql`LEFT JOIN LATERAL (
  SELECT u.id, u.name, u.phone, u.status FROM users u
  WHERE u.business_id = b.id
  ORDER BY (u.member_role = 'owner') DESC, u.created_at, u.id
  LIMIT 1
) o ON true`;

/** The business's listed industrial area (`ia`), for the list's area column and its search. */
const AREA_JOIN = sql`LEFT JOIN industrial_areas ia ON ia.id = b.industrial_area_id`;

/**
 * `search` matches the trade or legal name, the city, the linked industrial area's name and the typed "Other" area
 * (contains, any case; spec §8.2), the owner's phone (when the search is only digits and phone punctuation: its digits,
 * contained in the phone's digits) and the GSTIN (prefix, any case or spacing). Needs the `ia` join (AREA_JOIN).
 */
function searchCondition(raw: string): SQL | null {
  const q = raw.trim();
  if (q === '') return null;
  const contains = `%${escapeLike(q)}%`;
  const parts: SQL[] = [
    sql`b.trade_name ILIKE ${contains}`,
    sql`b.legal_name ILIKE ${contains}`,
    sql`b.city ILIKE ${contains}`,
    sql`ia.name ILIKE ${contains}`,
    sql`b.industrial_area_other ILIKE ${contains}`,
  ];
  const gstin = normalizeGstin(q);
  if (/^[0-9A-Z]{1,15}$/.test(gstin)) parts.push(sql`b.gstin LIKE ${`${gstin}%`}`);
  const digits = q.replace(/\D/g, '');
  if (/^[\d\s+()-]+$/.test(q) && digits.length >= 3) {
    parts.push(sql`regexp_replace(o.phone, '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`);
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** GET /admin/businesses: newest first, paged (`pageSize` ≤ 100), with the total for the filters. */
export async function listBusinesses(conn: Db | Tx, q: BusinessListQuery): Promise<AdminBusinessList> {
  const pageSize = Math.min(Math.max(1, Math.floor(q.pageSize)), PAGE_SIZE_MAX);
  const page = Math.max(1, Math.floor(q.page));
  const conditions: SQL[] = [];
  const search = q.search ? searchCondition(q.search) : null;
  if (search) conditions.push(search);
  if (q.city?.trim()) conditions.push(sql`lower(b.city) = lower(${q.city.trim()})`);
  if (q.industrialAreaId) conditions.push(sql`b.industrial_area_id = ${q.industrialAreaId}`);
  if (q.verification) conditions.push(sql`b.verification_status = ${q.verification}`);
  if (q.status) conditions.push(sql`o.status = ${q.status}`);
  const where = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  const { rows: countRows } = await conn.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM businesses b ${OWNER_JOIN} ${AREA_JOIN} ${where}
  `);
  const { rows } = await conn.execute<{
    id: string;
    trade_name: string;
    legal_name: string | null;
    gstin: string | null;
    city: string | null;
    state: string | null;
    area: string | null;
    verification_status: VerificationStatus;
    verification_levels: VerificationLevel[];
    created_at: string;
    owner_id: string | null;
    owner_name: string | null;
    owner_phone: string | null;
    owner_status: AccountStatus | null;
  }>(sql`
    SELECT b.id, b.trade_name, b.legal_name, b.gstin, b.city, b.state,
           coalesce(ia.name, b.industrial_area_other) AS area,
           b.verification_status, b.verification_levels,
           to_json(b.created_at)#>>'{}' AS created_at,
           o.id AS owner_id, o.name AS owner_name, o.phone AS owner_phone, o.status AS owner_status
    FROM businesses b
    ${OWNER_JOIN}
    ${AREA_JOIN}
    ${where}
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);

  return {
    rows: rows.map(
      (r): AdminBusinessRow => ({
        id: r.id,
        tradeName: r.trade_name,
        legalName: r.legal_name,
        gstin: r.gstin,
        city: r.city,
        state: r.state,
        industrialArea: r.area,
        verificationStatus: r.verification_status,
        verificationLevels: r.verification_levels,
        owner: r.owner_id ? { id: r.owner_id, name: r.owner_name, phone: r.owner_phone!, status: r.owner_status! } : null,
        createdAt: new Date(r.created_at).toISOString(),
      }),
    ),
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

/**
 * GET /admin/businesses/:id: the profile as the app shows it, its users, the GST state and history (no lookup details,
 * no document keys), whether a review is open, and the last 50 audit rows about the business, its users or its
 * reviews.
 */
export async function getBusinessDetail(conn: Db | Tx, id: string): Promise<AdminBusinessDetail> {
  const [b] = await conn
    .select({ id: businesses.id, verificationNote: businesses.verificationNote })
    .from(businesses)
    .where(eq(businesses.id, id));
  if (!b) throw new NotFoundError('Business');

  const members = await conn
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      status: users.status,
      memberRole: users.memberRole,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.businessId, id))
    .orderBy(sql`(${users.memberRole} = 'owner') DESC`, users.createdAt, users.id);
  const owner = members[0];

  const reviewIds = await conn
    .select({ id: gstRepresentativeProofs.id })
    .from(gstRepresentativeProofs)
    .where(and(eq(gstRepresentativeProofs.businessId, id), eq(gstRepresentativeProofs.method, 'documents')));
  const entityIds = [id, ...members.map((m) => m.id), ...reviewIds.map((r) => r.id)];
  const audit = await conn
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      adminId: auditLog.adminId,
      adminName: adminUsers.name,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(adminUsers, eq(adminUsers.id, auditLog.adminId))
    .where(inArray(auditLog.entityId, entityIds))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(AUDIT_LIMIT);

  // Every status but `draft`: the set `/admin/listings?businessId=` shows by default (F2 spec §11.4, plan Task 16, I12).
  const [listingTotal] = await conn
    .select({ n: count() })
    .from(listings)
    .where(and(eq(listings.businessId, id), ne(listings.status, 'draft')));

  return {
    profile: await businessProfile(conn, id, owner?.name ?? null),
    verificationNote: b.verificationNote,
    users: members.map((m) => ({ ...m, memberRole: m.memberRole as MemberRole, createdAt: m.createdAt.toISOString() })),
    gst: await getGstState(conn, id),
    reviewOpen: (await openReview(conn, id)) !== null,
    history: await gstHistory(conn, id),
    audit: audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    listingsCount: Number(listingTotal?.n ?? 0),
    // F6 + F7 §16.1: deals by status, disputes with outcomes and the review score.
    dealHistory: await businessDealHistory(conn, id),
    sellerScore: await sellerScore(conn, id),
    partRequestCount: 0,
  };
}

/**
 * The business row, locked first (the lock every GST write takes). `404` when it doesn't exist. `FOR NO KEY UPDATE`
 * unless the caller changes `gstin` (a unique key): F6 inserts referencing the business take `KEY SHARE`.
 */
async function lockBusiness(tx: Tx, id: string, mode: 'no key update' | 'update' = 'no key update') {
  const [row] = await tx.select().from(businesses).where(eq(businesses.id, id)).for(mode);
  if (!row) throw new NotFoundError('Business');
  return row;
}

export interface GstActionResult {
  id: string;
  gstin: string | null;
  verificationStatus: VerificationStatus;
  verificationLevels: VerificationLevel[];
}

/**
 * POST /admin/businesses/:id/gst/revoke (§5.4): the active `gst` verification becomes `revoked` (by, when, reason,
 * `revocation_source = officer`, which closes the instant path for good); `gst` leaves `verification_levels`; the
 * summary is `rejected` with the reason and `verified_at` cleared (§5.4a). The business keeps its GSTIN and GST fields;
 * the name unlocks (derived from the active verification). No active verification → `409 GST_NOT_VERIFIED`.
 */
export async function revokeGst(tx: Tx, adminId: string, businessId: string, reason: string): Promise<GstActionResult> {
  const why = adminText(reason);
  const business = await lockBusiness(tx, businessId);
  const [revoked] = await tx
    .update(businessVerifications)
    .set({ status: 'revoked', revokedByAdminId: adminId, revokedAt: sql`now()`, revokeReason: why, revocationSource: 'officer' })
    .where(
      and(
        eq(businessVerifications.businessId, businessId),
        eq(businessVerifications.level, 'gst'),
        eq(businessVerifications.status, 'active'),
      ),
    )
    .returning({ id: businessVerifications.id });
  if (!revoked) throw new ConflictError("This business's GST isn't verified", 'GST_NOT_VERIFIED');

  const levels = business.verificationLevels.filter((l) => l !== 'gst');
  await tx
    .update(businesses)
    .set({ verificationLevels: levels, verificationStatus: 'rejected', verificationNote: why, verifiedAt: null, updatedAt: sql`now()` })
    .where(eq(businesses.id, businessId));
  await writeAudit(tx, {
    adminId,
    action: 'gst.revoke',
    entityType: 'business',
    entityId: businessId,
    before: {
      gstin: business.gstin,
      verificationId: revoked.id,
      verificationLevels: business.verificationLevels,
      verificationStatus: business.verificationStatus,
    },
    after: { gstin: business.gstin, verificationLevels: levels, verificationStatus: 'rejected', reason: why },
  });
  return { id: businessId, gstin: business.gstin, verificationStatus: 'rejected', verificationLevels: levels as VerificationLevel[] };
}

/**
 * POST /admin/businesses/:id/gst/release (§5.4 "Release GSTIN"): clears `gstin`, `pan`, `legal_name`, `constitution`,
 * `gst_registered_on` and `gst_address`, so another business can verify the GSTIN; the summary is `not_submitted`
 * with the reason and `verified_at` cleared (§5.4a). Refused while a review is `waiting` / `needs_more` (`409
 * GST_REVIEW_OPEN`), while GST is verified (`409 GST_ALREADY_VERIFIED`: revoke first), and when no GSTIN is held
 * (`409 GSTIN_NOT_HELD`). Takes the GSTIN's advisory lock after the business row, like every change of who holds it.
 */
export async function releaseGstin(tx: Tx, adminId: string, businessId: string, reason: string): Promise<GstActionResult> {
  const why = adminText(reason);
  // Clears `gstin` (a unique key): the strong lock.
  const business = await lockBusiness(tx, businessId, 'update');
  if ((await openReview(tx, businessId)) !== null) {
    throw new ConflictError('This business has a GST review open. Decide it first.', 'GST_REVIEW_OPEN');
  }
  const [active] = await tx
    .select({ id: businessVerifications.id })
    .from(businessVerifications)
    .where(
      and(
        eq(businessVerifications.businessId, businessId),
        eq(businessVerifications.level, 'gst'),
        eq(businessVerifications.status, 'active'),
      ),
    );
  if (active) throw new ConflictError("This business's GST is verified. Revoke it first.", 'GST_ALREADY_VERIFIED');
  if (business.gstin === null) throw new ConflictError('This business holds no GSTIN', 'GSTIN_NOT_HELD');
  await lockGstin(tx, business.gstin);

  await tx
    .update(businesses)
    .set({
      gstin: null,
      pan: null,
      legalName: null,
      constitution: null,
      gstRegisteredOn: null,
      gstAddress: null,
      verificationStatus: 'not_submitted',
      verificationNote: why,
      verifiedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(businesses.id, businessId));
  await writeAudit(tx, {
    adminId,
    action: 'gst.release',
    entityType: 'business',
    entityId: businessId,
    before: {
      gstin: business.gstin,
      pan: business.pan,
      legalName: business.legalName,
      constitution: business.constitution,
      gstRegisteredOn: business.gstRegisteredOn,
      gstAddress: business.gstAddress,
      verificationStatus: business.verificationStatus,
    },
    after: { gstin: null, verificationStatus: 'not_submitted', reason: why },
  });
  return {
    id: businessId,
    gstin: null,
    verificationStatus: 'not_submitted',
    verificationLevels: business.verificationLevels as VerificationLevel[],
  };
}
