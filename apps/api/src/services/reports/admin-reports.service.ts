import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { REVIEW_FACETS, type AdminReportRow, type PartySide, type ReportStatus, type ReviewRatings } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { reports } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { AppError, ConflictError, ValidationError } from '../../lib/errors.js';
import { writeAudit } from '../audit.service.js';
import { maskedRequestName } from '../part-requests/reply-views.js';

/**
 * Admin Reports & flags for conversations, reviews and part requests (F6 + F7 spec §16.1–§16.2, P9; F8 spec §14): one
 * list for the three targets with a target filter, and the resolve (`actioned` / `dismissed` with a note, audit
 * `report.resolve`). Listing reports keep F2's own queue. Review text is shown as stored (staff); conversation text
 * never appears here (reads go through `POST /admin/threads/:id/read`); a part request shows its name masked and its id
 * (the row links to its admin page), never its note.
 */

type Conn = Db | Tx;

export type AdminReportTarget = 'conversation' | 'review' | 'part_request';

/** The targets this queue handles (listing reports keep F2's queue). */
export const ADMIN_REPORT_TARGETS = ['conversation', 'review', 'part_request'] as const;
const TARGETS_SQL = sql`r.target_type::text IN ('conversation', 'review', 'part_request')`;

interface Cursor {
  t: string;
  id: string;
}

const PAGE = 30;

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof c.t === 'string' && typeof c.id === 'string' && /^[0-9a-f-]{36}$/i.test(c.id) && !Number.isNaN(Date.parse(c.t))) {
      return { t: c.t, id: c.id };
    }
  } catch {
    // falls through
  }
  throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
}

type RawReport = {
  id: string;
  target: AdminReportTarget;
  target_id: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reporter_business_id: string | null;
  reporter_name: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  t_buyer_id: string | null;
  t_buyer_name: string | null;
  t_seller_id: string | null;
  t_seller_name: string | null;
  r_side: PartySide | null;
  r_reviewer_id: string | null;
  r_reviewer_name: string | null;
  r_reviewed_id: string | null;
  r_reviewed_name: string | null;
  r_matched_listing: number | null;
  r_communication: number | null;
  r_on_time: number | null;
  r_payment: number | null;
  r_pickup: number | null;
  /** M14 R11: a rental owner's `care` facet. */
  r_care: number | null;
  /** M14: the review is about a rental booking (its facets are `REVIEW_FACETS.rental`). */
  r_rental: boolean | null;
  r_text: string | null;
  r_reply_text: string | null;
  r_hidden: boolean | null;
  r_reply_hidden: boolean | null;
  p_id: string | null;
  p_name: string | null;
};

const COLUMN_OF: Record<string, keyof RawReport> = {
  matched_listing: 'r_matched_listing',
  communication: 'r_communication',
  on_time: 'r_on_time',
  payment: 'r_payment',
  pickup: 'r_pickup',
  care: 'r_care',
};

function ratingsOf(r: RawReport): ReviewRatings {
  const out: ReviewRatings = {};
  for (const facet of REVIEW_FACETS[r.r_rental ? 'rental' : 'deal'][r.r_side ?? 'buyer']) {
    const v = r[COLUMN_OF[facet]!] as number | null;
    if (v !== null) out[facet] = Number(v);
  }
  return out;
}

const iso = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);

function toRow(r: RawReport): AdminReportRow {
  return {
    id: r.id,
    target: r.target,
    targetId: r.target_id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    reporter: { businessId: r.reporter_business_id ?? '', name: r.reporter_name ?? '' },
    createdAt: new Date(r.created_at).toISOString(),
    resolvedAt: iso(r.resolved_at),
    resolutionNote: r.resolution_note,
    parties:
      r.target === 'conversation' && r.t_buyer_id && r.t_seller_id
        ? {
            buyer: { businessId: r.t_buyer_id, name: r.t_buyer_name ?? '' },
            seller: { businessId: r.t_seller_id, name: r.t_seller_name ?? '' },
          }
        : null,
    review:
      r.target === 'review' && r.r_reviewer_id && r.r_reviewed_id
        ? {
            id: r.target_id,
            reviewer: { businessId: r.r_reviewer_id, name: r.r_reviewer_name ?? '' },
            reviewed: { businessId: r.r_reviewed_id, name: r.r_reviewed_name ?? '' },
            ratings: ratingsOf(r),
            text: r.r_text,
            replyText: r.r_reply_text,
            hidden: r.r_hidden === true,
            replyHidden: r.r_reply_hidden === true,
          }
        : null,
    ...(r.target === 'part_request' && r.p_id
      ? { partRequestId: r.p_id, partRequestName: maskedRequestName(r.p_name ?? '') }
      : {}),
  };
}

async function queryReports(conn: Conn, where: SQL, limit: number): Promise<Array<RawReport & { sort_at: string }>> {
  const { rows } = await conn.execute<RawReport & { sort_at: string }>(sql`
    SELECT r.id, r.target_type::text AS target, r.target_id, r.reason, r.details, r.status,
           r.reporter_business_id, rb.trade_name AS reporter_name,
           to_json(r.created_at)#>>'{}' AS created_at, to_json(r.created_at)#>>'{}' AS sort_at,
           to_json(r.resolved_at)#>>'{}' AS resolved_at, r.resolution_note,
           t.buyer_business_id AS t_buyer_id, tb.trade_name AS t_buyer_name,
           t.seller_business_id AS t_seller_id, ts.trade_name AS t_seller_name,
           v.reviewer_side AS r_side, v.reviewer_business_id AS r_reviewer_id, vr.trade_name AS r_reviewer_name,
           v.reviewed_business_id AS r_reviewed_id, vd.trade_name AS r_reviewed_name,
           v.r_matched_listing, v.r_communication, v.r_on_time, v.r_payment, v.r_pickup, v.r_care,
           (v.rental_booking_id IS NOT NULL) AS r_rental,
           v.text AS r_text, v.reply_text AS r_reply_text,
           (v.hidden_at IS NOT NULL) AS r_hidden, (v.reply_hidden_at IS NOT NULL) AS r_reply_hidden,
           pr.id AS p_id, pr.name AS p_name
    FROM reports r
    LEFT JOIN businesses rb ON rb.id = r.reporter_business_id
    LEFT JOIN chat_threads t ON r.target_type::text = 'conversation' AND t.id = r.target_id
    LEFT JOIN businesses tb ON tb.id = t.buyer_business_id
    LEFT JOIN businesses ts ON ts.id = t.seller_business_id
    LEFT JOIN deal_reviews v ON r.target_type::text = 'review' AND v.id = r.target_id
    LEFT JOIN businesses vr ON vr.id = v.reviewer_business_id
    LEFT JOIN businesses vd ON vd.id = v.reviewed_business_id
    LEFT JOIN part_requests pr ON r.target_type::text = 'part_request' AND pr.id = r.target_id
    WHERE ${TARGETS_SQL} AND ${where}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${limit}`);
  return rows;
}

/** `GET /admin/reports?target=&status=&cursor=`: conversation, review and part-request reports, newest first, 30 a page. */
export async function listAdminReports(
  conn: Conn,
  opts: { target?: AdminReportTarget; status?: ReportStatus; cursor?: string },
): Promise<{ items: AdminReportRow[]; nextCursor: string | null }> {
  const conds: SQL[] = [sql`true`];
  if (opts.target) conds.push(sql`r.target_type::text = ${opts.target}`);
  if (opts.status) conds.push(sql`r.status = ${opts.status}::report_status`);
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    conds.push(sql`(r.created_at, r.id) < (${c.t}::timestamptz, ${c.id}::uuid)`);
  }
  const rows = await queryReports(conn, sql.join(conds, sql` AND `), PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: page.map(toRow),
    nextCursor: rows.length > PAGE && last ? encodeCursor({ t: last.sort_at, id: last.id }) : null,
  };
}

/**
 * `POST /admin/reports/:id/resolve { outcome, note }`: closes one open conversation, review or part-request report; `409
 * REPORT_NOT_OPEN` when it is already closed; audit `report.resolve` with before / after.
 */
export async function resolveAdminReport(
  tx: Tx,
  adminId: string,
  id: string,
  input: { outcome: 'actioned' | 'dismissed'; note: string },
): Promise<AdminReportRow> {
  const note = adminText(input.note, 'message');
  const [before] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.id, id), sql`${reports.targetType}::text IN ('conversation', 'review', 'part_request')`))
    .for('update');
  if (!before) throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
  if (before.status !== 'open' && before.status !== 'reviewing') {
    throw new ConflictError('This report is already closed', 'REPORT_NOT_OPEN');
  }
  await tx
    .update(reports)
    .set({ status: input.outcome, resolvedBy: adminId, resolvedAt: sql`now()`, resolutionNote: note })
    .where(and(eq(reports.id, id), inArray(reports.status, ['open', 'reviewing'])));
  await writeAudit(tx, {
    adminId,
    action: 'report.resolve',
    entityType: 'report',
    entityId: id,
    before: { status: before.status, target: before.targetType, targetId: before.targetId },
    after: { status: input.outcome, note },
  });
  const [row] = await queryReports(tx, sql`r.id = ${id}`, 1);
  return toRow(row!);
}

/** Every report on one target (any status), newest first: the part-request admin detail's Reports block (F8 §14). */
export async function adminReportsForTarget(conn: Conn, target: AdminReportTarget, targetId: string): Promise<AdminReportRow[]> {
  const rows = await queryReports(conn, sql`r.target_type::text = ${target} AND r.target_id = ${targetId}`, 100);
  return rows.map(toRow);
}
