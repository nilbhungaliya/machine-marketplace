import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  MODERATION_DECIDED_DAYS,
  MODERATION_PAGE_SIZE,
  normalizePartNumber,
  partNumberBase,
  type AccountStatus,
  type AdminListingAction,
  type AdminListingBulkAction,
  type AdminListingBulkResult,
  type AdminListingDetail,
  type AdminListingFilters,
  type AdminListingList,
  type AdminListingPageSize,
  type AdminListingPatch,
  type AdminListingReport,
  type AdminListingRow,
  type AdminModerationQueue,
  type AdminModerationRow,
  type ListingFlag,
  type ListingHistoryEntry,
  type ListingKind,
  type ListingReportReason,
  type ListingStatus,
  type ModerationCounts,
  type ModerationTab,
  type PartSide,
  type PriceModel,
  type ReportResolution,
  type ReportStatus,
  type ReviewReason,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { adminUsers, businesses, listingFitments, listingMachines, listingStatusHistory, listings, reports, users } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { AppError, ConflictError, ValidationError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';
import { cancelAgreedDealsForRemovedListing } from '../deals/deal-cancel.js';
import { afterListingStatusWrite } from '../deals/holds.js';
import { validateSpecs } from '../catalog/validate-specs.js';
import { getSettings } from '../settings.service.js';
import { applyAdminTransition } from './listing-lifecycle.service.js';
import {
  fitmentsDiffer,
  loadNode,
  same,
  templateKindOf,
  validateCategory,
  validateFitments,
  validateMachine,
  type ListingNode,
  type MachineColumns,
  type StoredFitment,
} from './listing-validate.service.js';
import { headlineRate, toOwnerView } from './listing-view.service.js';
import { listingNotFound, lockBusinessThenListing, lockListingOnly, type BusinessRow, type ListingRow } from './locks.js';
import { refreshListingSearch } from '../discovery/search-text.js';
import { matchRelevantChange } from '../part-requests/listing-hooks.js';
import { enqueuePartRequestWork } from '../part-requests/work-queue.js';

// Listing moderation and the admin's listing pages (F2 spec §11, R33, R34, R50–R53; plan Task 16): the moderation queue
// and its counts, the review screen's detail, the moderator's status actions (through `applyAdminTransition`, which
// owns the status write), the admin edit of category / side / fit, resolving reports, bulk hide / remove and the
// all-listings list. Every mutation writes one `audit_log` row with the action strings of §11.6. Admin payloads carry
// the private fields (serial number, address line, pincode, point) a moderator needs.

type Conn = Db | Tx;

const OPEN_REPORT = sql`r.target_type = 'listing' AND r.status IN ('open', 'reviewing')`;
/** An ISO 8601 string of a timestamp column (raw queries return driver strings otherwise). */
const isoOf = (col: SQL) => sql`to_json(${col})#>>'{}'`;
const toIso = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

function listingChanged(): ConflictError {
  return new ConflictError('The seller changed this listing since you opened it', 'LISTING_CHANGED');
}

/** Reads the listing's business, then locks the business and the listing in the usual order (`404` when unknown). */
async function lockForAdmin(tx: Tx, id: string): Promise<{ business: BusinessRow; listing: ListingRow }> {
  const [row] = await tx.select({ businessId: listings.businessId }).from(listings).where(eq(listings.id, id));
  if (!row) throw listingNotFound();
  return lockBusinessThenListing(tx, row.businessId, id);
}

// ─── Moderation queue (§11.1) ───

/** The first photo's thumbnail key of `l`. */
const THUMB = sql`(SELECT m.thumb_key FROM listing_media m WHERE m.listing_id = l.id AND m.type = 'photo' ORDER BY m.sort_order, m.created_at LIMIT 1)`;
/** `r_open`, `r_first`, `r_last`: the listing's open reports. */
const REPORTS_LATERAL = sql`LEFT JOIN LATERAL (
  SELECT count(*)::int AS n, min(r.created_at) AS first_at, max(r.created_at) AS last_at
  FROM reports r WHERE r.target_id = l.id AND ${OPEN_REPORT}
) rep ON true`;
/** `dec`: the listing's last moderator decision within `MODERATION_DECIDED_DAYS`. */
const DECIDED_LATERAL = sql`JOIN LATERAL (
  SELECT h.action, h.created_at FROM listing_status_history h
  WHERE h.listing_id = l.id AND h.actor = 'admin' AND h.action IN ('approve', 'ask_for_changes', 'reject', 'hide', 'remove')
    AND h.created_at > now() - make_interval(days => ${MODERATION_DECIDED_DAYS}::int)
  ORDER BY h.created_at DESC LIMIT 1
) dec ON true`;

interface QueueSql {
  from: SQL;
  where: SQL;
  order: SQL;
  decided: boolean;
}

function queueSql(tab: ModerationTab): QueueSql {
  const base = sql`FROM listings l JOIN businesses b ON b.id = l.business_id ${REPORTS_LATERAL}`;
  switch (tab) {
    case 'review':
      return { from: base, where: sql`l.status = 'pending_review'`, order: sql`l.status_changed_at ASC NULLS FIRST, l.id`, decided: false };
    case 'reported':
      return { from: base, where: sql`l.status <> 'removed' AND rep.n > 0`, order: sql`rep.n DESC, rep.first_at ASC, l.id`, decided: false };
    case 'decided':
      return { from: sql`${base} ${DECIDED_LATERAL}`, where: sql`true`, order: sql`dec.created_at DESC, l.id`, decided: true };
  }
}

/**
 * `GET /admin/moderation/queue?tab=&page=` (§11.1), 50 a page. **Review:** `pending_review`, oldest status change
 * first, with the review reasons as pills. **Reported:** listings in any status but `removed` with an open report, most
 * open reports first, then the oldest report. **Decided:** listings a moderator approved, asked to change, rejected, hid
 * or removed in the last 90 days, by their latest such decision, newest first.
 */
export async function moderationQueue(conn: Conn, tab: ModerationTab, page: number): Promise<AdminModerationQueue> {
  const q = queueSql(tab);
  const { rows: totalRows } = await conn.execute<{ n: number }>(sql`SELECT count(*)::int AS n ${q.from} WHERE ${q.where}`);
  const { rows } = await conn.execute<{
    id: string;
    ref: string;
    title: string | null;
    kind: ListingKind;
    status: ListingStatus;
    side: PartSide | null;
    review_reasons: ReviewReason[];
    status_changed_at: string | null;
    business_id: string;
    business_name: string;
    gst_verified: boolean;
    thumb_key: string | null;
    open_reports: number;
    last_report_at: string | null;
    decision_action: AdminListingAction | null;
    decision_at: string | null;
  }>(sql`
    SELECT l.id, l.ref, l.title, l.kind, l.status, l.side, l.review_reasons, ${isoOf(sql`l.status_changed_at`)} AS status_changed_at,
           b.id AS business_id, b.trade_name AS business_name, (b.verification_levels ? 'gst') AS gst_verified,
           ${THUMB} AS thumb_key, rep.n AS open_reports, ${isoOf(sql`rep.last_at`)} AS last_report_at,
           ${q.decided ? sql`dec.action` : sql`NULL`} AS decision_action,
           ${q.decided ? isoOf(sql`dec.created_at`) : sql`NULL`} AS decision_at
    ${q.from}
    WHERE ${q.where}
    ORDER BY ${q.order}
    LIMIT ${MODERATION_PAGE_SIZE} OFFSET ${(page - 1) * MODERATION_PAGE_SIZE}
  `);
  return {
    tab,
    rows: rows.map(
      (r): AdminModerationRow => ({
        id: r.id,
        ref: Number(r.ref),
        thumbUrl: publicUrl(r.thumb_key),
        title: r.title ?? '',
        kind: r.kind,
        status: r.status,
        side: r.side,
        business: { id: r.business_id, name: r.business_name, gstVerified: !!r.gst_verified },
        reviewReasons: r.review_reasons ?? [],
        statusChangedAt: toIso(r.status_changed_at),
        openReports: Number(r.open_reports ?? 0),
        lastReportAt: toIso(r.last_report_at),
        decision: r.decision_action && r.decision_at ? { action: r.decision_action, at: toIso(r.decision_at)! } : null,
      }),
    ),
    total: Number(totalRows[0]?.n ?? 0),
    page,
    pageSize: MODERATION_PAGE_SIZE,
  };
}

/** `GET /admin/moderation/counts`: the Review and Reported tabs' totals (the nav badge is their sum). */
export async function moderationCounts(conn: Conn): Promise<ModerationCounts> {
  const { rows } = await conn.execute<{ review: number; reported: number }>(sql`
    SELECT
      (SELECT count(*) FROM listings l WHERE l.status = 'pending_review')::int AS review,
      (SELECT count(*) FROM listings l WHERE l.status <> 'removed'
         AND EXISTS (SELECT 1 FROM reports r WHERE r.target_id = l.id AND ${OPEN_REPORT}))::int AS reported
  `);
  return { review: Number(rows[0]?.review ?? 0), reported: Number(rows[0]?.reported ?? 0) };
}

// ─── Review screen (§11.2) ───

/**
 * `GET /admin/listings/:id` (§11.2), any status: the owner view (private fields, `full` image URLs, score, flags) plus
 * `returnStatus`, `firstLiveAt`, `statusChangedAt`; the node's side convention; the seller panel (trade name, GST,
 * owner's account status, member since, listings by status, how many ever went live); every report, newest first; the
 * status history, newest first.
 */
export async function adminListingDetail(conn: Conn, id: string): Promise<AdminListingDetail> {
  const [row] = await conn.select().from(listings).where(eq(listings.id, id));
  if (!row) throw listingNotFound();
  const view = await toOwnerView(conn, row, await getSettings(conn));
  const node = row.categoryId ? await loadNode(conn, row.categoryId) : null;

  const [business] = await conn.select().from(businesses).where(eq(businesses.id, row.businessId));
  const [owner] = await conn
    .select({ status: users.status })
    .from(users)
    .where(eq(users.businessId, row.businessId))
    .orderBy(sql`(${users.memberRole} = 'owner') DESC`, asc(users.createdAt), asc(users.id))
    .limit(1);
  const byStatus = await conn
    .select({ status: listings.status, n: sql<number>`count(*)::int` })
    .from(listings)
    .where(eq(listings.businessId, row.businessId))
    .groupBy(listings.status);
  const [everLive] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.businessId, row.businessId), sql`${listings.firstLiveAt} IS NOT NULL`));

  const reportRows = await conn
    .select({ r: reports, businessName: businesses.tradeName })
    .from(reports)
    .leftJoin(businesses, eq(businesses.id, reports.reporterBusinessId))
    .where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, id)))
    .orderBy(desc(reports.createdAt), desc(reports.id));
  const historyRows = await conn
    .select({ h: listingStatusHistory, adminName: adminUsers.name })
    .from(listingStatusHistory)
    .leftJoin(adminUsers, eq(adminUsers.id, listingStatusHistory.adminId))
    .where(eq(listingStatusHistory.listingId, id))
    .orderBy(desc(listingStatusHistory.createdAt), desc(listingStatusHistory.id));

  return {
    listing: {
      ...view,
      returnStatus: row.returnStatus,
      firstLiveAt: row.firstLiveAt?.toISOString() ?? null,
      statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    },
    sideConvention: node?.effectiveSideConvention ?? null,
    seller: {
      businessId: row.businessId,
      name: business?.tradeName ?? '',
      gstVerified: !!business?.verificationLevels.includes('gst'),
      ownerStatus: (owner?.status as AccountStatus | undefined) ?? null,
      memberSince: business?.createdAt.toISOString() ?? '',
      listingsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)])) as Partial<Record<ListingStatus, number>>,
      everLive: Number(everLive?.n ?? 0),
    },
    reports: reportRows.map(
      ({ r, businessName }): AdminListingReport => ({
        id: r.id,
        reason: r.reason as ListingReportReason,
        details: r.details,
        status: r.status as ReportStatus,
        reporter: { businessId: r.reporterBusinessId, businessName: businessName ?? null },
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolutionNote: r.resolutionNote,
      }),
    ),
    history: historyRows.map(
      ({ h, adminName }): ListingHistoryEntry => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        action: h.action,
        actor: h.actor,
        adminName: adminName ?? null,
        reason: h.reason,
        createdAt: h.createdAt.toISOString(),
      }),
    ),
    // M14 C0-3b / A3 fill a rental's bookings and blocks.
    rental: null,
  };
}

// ─── Status actions (§11.3) ───

/** Columns a moderator's status action may change: the audit row's before / after keep those that did. */
const AUDITED = ['status', 'returnStatus', 'statusReason', 'moderationOutcome', 'moderationNote', 'acceptedFlags', 'reviewReasons'] as const;

function auditDiff(before: ListingRow, after: ListingRow): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of AUDITED) {
    if (!same(before[key], after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

export interface AdminActionOptions {
  /** Approve, ask for changes, reject: the version the moderator loaded (R53). */
  version?: number;
  /** Reject / hide / remove reason, or the ask-for-changes message. */
  reason?: string | null;
  /** A bulk action: marked in the audit row. */
  bulk?: boolean;
}

/**
 * One moderator status action (§11.3) in the caller's transaction: locks the business, then the listing, runs
 * `applyAdminTransition` (version check for approve / ask for changes / reject, required reasons, photo and rental-GST
 * checks, reports actioned on hide and remove) and writes the `listing.<action>` audit row with the changed columns
 * (and, on hide / remove, how many open reports it actioned). A refused action writes nothing.
 *
 * F6 + F7 (§8.3, §22): `remove` first cancels the listing's `agreed` deals (`cancelAgreedDealsForRemovedListing`,
 * holds released; `handed_over` / `disputed` deals continue); after the status write `afterListingStatusWrite` runs
 * (an unhide or approval of a fully held listing lands `reserved`, a sold-out one `sold`). Returns the listing after
 * the hook; the audit row records the moderator's own move.
 */
export async function adminListingAction(
  tx: Tx,
  adminId: string,
  id: string,
  action: AdminListingAction,
  opts: AdminActionOptions = {},
): Promise<ListingRow> {
  const { listing } = await lockForAdmin(tx, id);
  let openReports = 0;
  if (action === 'hide' || action === 'remove') {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, id), inArray(reports.status, ['open', 'reviewing'])));
    openReports = Number(r?.n ?? 0);
  }
  // The cancel releases holds, and its syncReservation may move a reserved listing back to live: the transition runs
  // from the row as it is after the cancel (the audit's `before` keeps the moderator's view).
  let from = listing;
  if (action === 'remove') {
    await cancelAgreedDealsForRemovedListing(tx, id, adminId);
    from = await lockListingOnly(tx, id);
  }
  const row = await applyAdminTransition(tx, adminId, from, action, { version: opts.version, reason: opts.reason });
  const diff = auditDiff(listing, row);
  await writeAudit(tx, {
    adminId,
    action: `listing.${action}`,
    entityType: 'listing',
    entityId: id,
    before: diff.before,
    after: { ...diff.after, ...(openReports > 0 ? { reportsActioned: openReports } : {}), ...(opts.bulk ? { bulk: true } : {}) },
  });
  return afterListingStatusWrite(tx, id);
}

// ─── Admin edit: category, side, fit (§11.3, R33) ───

const invalid = (code: string, message: string, details?: Record<string, unknown>) => new ValidationError(message, details, code);

/** Statuses an admin can't edit: a draft is the seller's, a removed listing is final. */
const ADMIN_NOT_EDITABLE: readonly ListingStatus[] = ['draft', 'removed'];

/**
 * `PATCH /admin/listings/:id` (§11.3, R33), in the caller's transaction, under the business → listing locks. The
 * `version` must match (`409 LISTING_CHANGED`: no write, no audit). Not on a draft or a removed listing
 * (`409 LISTING_NOT_EDITABLE`); side and fitments are parts only (`400 FIELD_NOT_FOR_KIND`).
 * - **Category:** an active node of the kind's level (`400 CATEGORY_INVALID`) under which the stored specs validate
 *   whole, required fields included (`400 SPECS_INVALID` with the field errors); a machine's catalogue model that isn't
 *   of the new machine type is dropped. A part moved to a node without sides gets `not_applicable`.
 * - **Side:** must suit the (new) node: a node without sides takes only `not_applicable` (`400 SIDE_NOT_ALLOWED`), a
 *   node with sides needs left, right or pair (`400 SIDE_REQUIRED`); checked when the side or the category changes, so
 *   the edited fields leave the listing publishable. The part number's side-stripped base is recomputed.
 * - **Fitments:** validated row by row (unchanged rows grandfathered and keeping their source); new or edited rows get
 *   `source = 'admin'`.
 * Status unchanged, `version + 1`, `refreshed_at` untouched; one `listing.edit` audit row with the changed fields. An
 * edit that changes nothing writes nothing.
 */
export async function adminPatchListing(tx: Tx, adminId: string, id: string, patch: AdminListingPatch): Promise<void> {
  const { listing } = await lockForAdmin(tx, id);
  if (patch.version !== listing.version) throw listingChanged();
  if (ADMIN_NOT_EDITABLE.includes(listing.status)) throw new ConflictError("This listing can't be edited now", 'LISTING_NOT_EDITABLE');
  const kind = listing.kind;
  if (kind !== 'part') {
    for (const field of ['side', 'fitments'] as const) {
      if (patch[field] !== undefined) throw invalid('FIELD_NOT_FOR_KIND', `A ${kind.replace('_', ' ')} listing has no ${field}`, { field });
    }
  }

  const set: Partial<typeof listings.$inferInsert> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  // Category (R33): only when the stored specs validate under the new node.
  let node: ListingNode | null = null;
  const categoryChanged = patch.categoryId !== undefined && patch.categoryId !== listing.categoryId;
  if (categoryChanged) {
    node = await validateCategory(tx, patch.categoryId!, kind);
    const result = await validateSpecs(tx, patch.categoryId!, templateKindOf(kind), listing.specs, listing.specs);
    if (!result.ok) throw invalid('SPECS_INVALID', "This listing's specifications don't fit that category", result.errors);
    set.categoryId = patch.categoryId;
    before.categoryId = listing.categoryId;
    after.categoryId = patch.categoryId;
  }

  // Side (parts).
  let side = listing.side;
  if (kind === 'part' && (categoryChanged || (patch.side !== undefined && patch.side !== listing.side))) {
    node ??= listing.categoryId ? await loadNode(tx, listing.categoryId, { lock: true }) : null;
    const hasSides = node?.effectiveHasSides ?? false;
    side = patch.side ?? (hasSides ? listing.side : 'not_applicable');
    if (!hasSides && side !== 'not_applicable') throw invalid('SIDE_NOT_ALLOWED', 'This part group has no left or right side');
    if (hasSides && (side === null || side === 'not_applicable')) throw invalid('SIDE_REQUIRED', 'Pick left, right or pair');
    if (side !== listing.side) {
      set.side = side;
      set.partNumberBase = listing.partNumberNorm ? partNumberBase(listing.partNumberNorm, side) : null;
      before.side = listing.side;
      after.side = side;
    }
  }

  // Fitments (parts): edited rows are the admin's.
  let fitments: StoredFitment[] | null = null;
  if (kind === 'part' && patch.fitments !== undefined) {
    const stored: StoredFitment[] = await tx
      .select({
        brandId: listingFitments.brandId, modelId: listingFitments.modelId, modelOther: listingFitments.modelOther,
        yearFrom: listingFitments.yearFrom, yearTo: listingFitments.yearTo, note: listingFitments.note, source: listingFitments.source,
      })
      .from(listingFitments)
      .where(eq(listingFitments.listingId, listing.id))
      .orderBy(asc(listingFitments.sortOrder));
    const sent = patch.fitments.map((f) => ({
      brandId: f.brandId,
      modelId: f.modelId ?? null,
      modelOther: f.modelOther?.trim() || null,
      yearFrom: f.yearFrom ?? null,
      yearTo: f.yearTo ?? null,
      note: f.note?.trim() || null,
    }));
    if (fitmentsDiffer(sent, stored)) {
      const validated = await validateFitments(tx, sent, stored, { checkAll: false });
      const unused = [...stored];
      fitments = validated.map((f) => {
        const i = unused.findIndex((s) => !fitmentsDiffer([s], [f]));
        if (i < 0) return { ...f, source: 'admin' as const };
        const [kept] = unused.splice(i, 1);
        return { ...f, source: kept!.source };
      });
      before.fitments = stored;
      after.fitments = fitments;
    }
  }

  // A machine's catalogue model that isn't of the new machine type is dropped (as the seller's category change).
  let machine: MachineColumns | null = null;
  if (kind !== 'part' && categoryChanged) {
    const [m] = await tx.select().from(listingMachines).where(eq(listingMachines.listingId, listing.id));
    if (m) {
      const { listingId: _id, ...stored } = m;
      const next = await validateMachine(tx, stored, {}, { machineTypeId: patch.categoryId!, categoryChanged: true, loose: false });
      if (!same(next, stored)) {
        machine = next;
        before.machineModelId = stored.modelId;
        after.machineModelId = next.modelId;
      }
    }
  }

  if (Object.keys(set).length === 0 && !fitments && !machine) return;

  const [updated] = await tx
    .update(listings)
    .set({ ...set, version: sql`${listings.version} + 1`, updatedAt: sql`now()` })
    .where(eq(listings.id, listing.id))
    .returning();
  if (fitments) {
    await tx.delete(listingFitments).where(eq(listingFitments.listingId, listing.id));
    if (fitments.length > 0) await tx.insert(listingFitments).values(fitments.map((f, i) => ({ listingId: listing.id, ...f, sortOrder: i })));
  }
  if (machine) await tx.update(listingMachines).set(machine).where(eq(listingMachines.listingId, listing.id));
  // F4 + F5 §5.2: category, fitments or machine model changed.
  await refreshListingSearch(tx, [listing.id]);
  // F8 §8.1: a live listing's category, side, fitments or machine model edit is re-matched.
  if (updated!.status === 'live' && kind !== 'machine_rental' && matchRelevantChange(listing, updated!, fitments !== null || machine !== null)) {
    await enqueuePartRequestWork(tx, 'listing_changed', listing.id);
  }
  await writeAudit(tx, { adminId, action: 'listing.edit', entityType: 'listing', entityId: id, before, after });
}

// ─── Reports (§11.3) ───

/**
 * `POST /admin/listings/:id/reports/resolve`: closes **all** the listing's open reports with the outcome
 * (`dismissed` / `actioned`) and the optional note; `409 NO_OPEN_REPORTS` when there are none. One
 * `listing_reports.resolve` audit row. The listing's status doesn't change.
 */
export async function resolveListingReports(
  tx: Tx,
  adminId: string,
  id: string,
  input: { outcome: ReportResolution; note?: string | null },
): Promise<void> {
  await lockForAdmin(tx, id);
  const note = input.note?.trim() || null;
  const closed = await tx
    .update(reports)
    .set({ status: input.outcome, resolvedBy: adminId, resolvedAt: sql`now()`, resolutionNote: note })
    .where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, id), inArray(reports.status, ['open', 'reviewing'])))
    .returning({ id: reports.id });
  if (closed.length === 0) throw new ConflictError('This listing has no open reports', 'NO_OPEN_REPORTS');
  await writeAudit(tx, {
    adminId,
    action: 'listing_reports.resolve',
    entityType: 'listing',
    entityId: id,
    before: { openReports: closed.length },
    after: { outcome: input.outcome, note, reportIds: closed.map((r) => r.id) },
  });
}

// ─── Bulk (§11.3, R34) ───

/**
 * `POST /admin/listings/bulk`: hide or remove up to 50 listings with one reason (checked once: `400` for the whole
 * request), **one transaction per listing** (`runTx`, so each listing's queued emits go out when it commits), one
 * audit row each. A listing the action can't apply to is skipped with its error code (`LISTING_NOT_FOUND`,
 * `LISTING_TRANSITION_NOT_ALLOWED`, …); the others still apply. One transaction each rather than savepoints of one:
 * a single transaction would hold every listed business's lock until the end.
 */
export async function bulkListingAction(
  app: TxApp,
  adminId: string,
  input: { action: AdminListingBulkAction; ids: string[]; reason: string },
): Promise<AdminListingBulkResult> {
  const reason = adminText(input.reason);
  const result: AdminListingBulkResult = { done: [], skipped: [] };
  for (const id of [...new Set(input.ids)]) {
    try {
      await runTx(app, (tx) => adminListingAction(tx, adminId, id, input.action, { reason, bulk: true }));
      result.done.push(id);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      result.skipped.push({ id, code: err.code });
    }
  }
  return result;
}

// ─── All listings (§11.4) ───

/** `%`, `_` and `\` match themselves. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const sqlList = <T extends string>(values: readonly T[]): SQL => sql.join(values.map((v) => sql`${v}`), sql`, `);

/**
 * `q` (§11.4): the title (contains, any case), the normalised part number (contains: `tp 200` finds `TP-200L`), a
 * reference (`#100123` or `100123`) and the business's trade or legal name (contains).
 */
function searchSql(raw: string): SQL | null {
  const q = raw.trim();
  if (q === '') return null;
  const contains = `%${escapeLike(q)}%`;
  const parts: SQL[] = [sql`l.title ILIKE ${contains}`, sql`b.trade_name ILIKE ${contains}`, sql`b.legal_name ILIKE ${contains}`];
  const norm = normalizePartNumber(q);
  if (norm.length >= 2) parts.push(sql`l.part_number_norm LIKE ${`%${norm}%`}`);
  const ref = /^#?\s*(\d{1,15})$/.exec(q);
  if (ref) parts.push(sql`l.ref = ${Number(ref[1])}`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

export interface AdminListingQuery extends AdminListingFilters {
  page: number;
  pageSize: AdminListingPageSize;
}

/**
 * `GET /admin/listings` (§11.4): newest update first, paged (25 / 50 / 100). Filters: status (several; default every
 * status but `draft`), kind, machine category (listings anywhere under that root), city (exact, any case), side, flags
 * (any of them), has open reports, business (`businessId`, whose name comes back in `business` for the filter chip),
 * and `q` (`searchSql`).
 */
export async function listAdminListings(conn: Conn, f: AdminListingQuery): Promise<AdminListingList> {
  const where: SQL[] = [];
  where.push(f.status?.length ? sql`l.status IN (${sqlList(f.status)})` : sql`l.status <> 'draft'`);
  if (f.kind) where.push(sql`l.kind = ${f.kind}`);
  if (f.machineCategoryId) {
    where.push(sql`EXISTS (
      SELECT 1 FROM categories root WHERE root.id = ${f.machineCategoryId}
        AND (c.id = root.id OR left(c.path, length(root.path) + 1) = root.path || '/')
    )`);
  }
  if (f.city?.trim()) where.push(sql`lower(l.city) = lower(${f.city.trim()})`);
  if (f.side) where.push(sql`l.side = ${f.side}`);
  if (f.flags?.length) where.push(sql`l.flags && ARRAY[${sqlList(f.flags)}]::text[]`);
  if (f.reported) where.push(sql`EXISTS (SELECT 1 FROM reports r WHERE r.target_id = l.id AND ${OPEN_REPORT})`);
  if (f.businessId) where.push(sql`l.business_id = ${f.businessId}`);
  const search = f.q ? searchSql(f.q) : null;
  if (search) where.push(search);
  const whereSql = sql.join(where, sql` AND `);
  const from = sql`FROM listings l
    JOIN businesses b ON b.id = l.business_id
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
    LEFT JOIN categories g ON g.id = p.parent_id
    LEFT JOIN listing_rentals rt ON rt.listing_id = l.id`;

  const { rows: totalRows } = await conn.execute<{ n: number }>(sql`SELECT count(*)::int AS n ${from} WHERE ${whereSql}`);
  const { rows } = await conn.execute<{
    id: string;
    ref: string;
    title: string | null;
    kind: ListingKind;
    status: ListingStatus;
    city: string | null;
    side: PartSide | null;
    price_model: PriceModel | null;
    price_paise: string | null;
    flags: ListingFlag[];
    updated_at: string;
    business_id: string;
    business_name: string;
    c_name: string | null;
    p_name: string | null;
    g_name: string | null;
    rate_hour_paise: string | null;
    rate_day_paise: string | null;
    rate_week_paise: string | null;
    rate_month_paise: string | null;
    thumb_key: string | null;
    open_reports: number;
  }>(sql`
    SELECT l.id, l.ref, l.title, l.kind, l.status, l.city, l.side, l.price_model, l.price_paise, l.flags,
           ${isoOf(sql`l.updated_at`)} AS updated_at, b.id AS business_id, b.trade_name AS business_name,
           c.name AS c_name, p.name AS p_name, g.name AS g_name,
           rt.rate_hour_paise, rt.rate_day_paise, rt.rate_week_paise, rt.rate_month_paise,
           ${THUMB} AS thumb_key,
           (SELECT count(*)::int FROM reports r WHERE r.target_id = l.id AND ${OPEN_REPORT}) AS open_reports
    ${from}
    WHERE ${whereSql}
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}
  `);

  let business: AdminListingList['business'] = null;
  if (f.businessId) {
    const [b] = await conn.select({ id: businesses.id, name: businesses.tradeName }).from(businesses).where(eq(businesses.id, f.businessId));
    business = b ?? null;
  }

  return {
    rows: rows.map(
      (r): AdminListingRow => ({
        id: r.id,
        ref: Number(r.ref),
        thumbUrl: publicUrl(r.thumb_key),
        title: r.title ?? '',
        kind: r.kind,
        status: r.status,
        categoryPath: [r.g_name, r.p_name, r.c_name].filter((n): n is string => n !== null),
        city: r.city,
        side: r.side,
        business: { id: r.business_id, name: r.business_name },
        priceModel: r.price_model,
        pricePaise: num(r.price_paise),
        rate:
          r.kind === 'machine_rental'
            ? headlineRate({
                rateDayPaise: num(r.rate_day_paise),
                rateHourPaise: num(r.rate_hour_paise),
                rateWeekPaise: num(r.rate_week_paise),
                rateMonthPaise: num(r.rate_month_paise),
              })
            : null,
        flags: r.flags ?? [],
        openReports: Number(r.open_reports ?? 0),
        updatedAt: new Date(r.updated_at).toISOString(),
      }),
    ),
    total: Number(totalRows[0]?.n ?? 0),
    page: f.page,
    pageSize: f.pageSize,
    business,
  };
}
