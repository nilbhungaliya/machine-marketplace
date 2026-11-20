import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  AdminPartRequestDetail,
  AdminPartRequestList,
  PartRequestKind,
  PartRequestPhotos,
  PartRequestStatus,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { partRequests, reports } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';
import { privatePhotoUrl } from '../chat/private-photo.js';
import { notify } from '../notifications/notify.js';
import { ADMIN_ROW_COLUMNS, adminDetailView, toAdminRow, type AdminRowRaw } from './admin-view.js';
import { writeRequestStatus } from './lifecycle.js';
import { lockPartRequest, partRequestNotFound } from './locks.js';
import { dropPendingRepliesForRequest } from './reply-drops.js';
import { maskedRequestName } from './reply-views.js';

/**
 * Admin part requests (F8 spec §14, §9.1 `remove` / `restore`; textile `routes/admin/requirements.ts` +
 * `services/requirements/requirement-reports.service.ts`). Moderators and support. Every mutation runs in one
 * transaction that locks the request `FOR NO KEY UPDATE` (never `FOR UPDATE`, never a business row; §9.5) and writes
 * `audit_log` in it.
 */

type Conn = Db | Tx;

export const ADMIN_PART_REQUEST_PAGE_SIZES = [25, 50, 100] as const;

export interface AdminPartRequestFilters {
  status?: PartRequestStatus;
  kind?: PartRequestKind;
  /** A machine category (root): requests anywhere in its subtree. */
  machineCategoryId?: string;
  /** true: with an open (or reviewing) report; false: without. */
  reported?: boolean;
  businessId?: string;
  /** Created on or after / before (ISO). */
  from?: string;
  to?: string;
  /** The buyer business's trade name (contains), or its owner's phone (digits contained). */
  q?: string;
  page: number;
  pageSize: number;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function whereOf(f: Partial<AdminPartRequestFilters>): SQL {
  const conds: SQL[] = [sql`true`];
  if (f.status) conds.push(sql`pr.status = ${f.status}::part_request_status`);
  if (f.kind) conds.push(sql`pr.kind = ${f.kind}::part_request_kind`);
  if (f.businessId) conds.push(sql`pr.business_id = ${f.businessId}::uuid`);
  if (f.machineCategoryId) {
    conds.push(sql`EXISTS (SELECT 1 FROM categories root JOIN categories c ON c.id = pr.category_id
      WHERE root.id = ${f.machineCategoryId}::uuid AND (c.path = root.path OR c.path LIKE root.path || '/%'))`);
  }
  if (f.reported !== undefined) {
    const open = sql`EXISTS (SELECT 1 FROM reports rp WHERE rp.target_type::text = 'part_request' AND rp.target_id = pr.id
      AND rp.status IN ('open', 'reviewing'))`;
    conds.push(f.reported ? open : sql`NOT ${open}`);
  }
  if (f.from) conds.push(sql`pr.created_at >= ${f.from}::timestamptz`);
  if (f.to) conds.push(sql`pr.created_at < ${f.to}::timestamptz`);
  const q = f.q?.trim();
  if (q) {
    const parts: SQL[] = [sql`b.trade_name ILIKE ${`%${escapeLike(q)}%`}`];
    const digits = q.replace(/\D/g, '');
    if (/^[\d\s+()-]+$/.test(q) && digits.length >= 3) {
      parts.push(sql`EXISTS (SELECT 1 FROM users o WHERE o.business_id = b.id AND o.member_role = 'owner'
        AND regexp_replace(o.phone, '[^0-9]', '', 'g') LIKE ${`%${digits}%`})`);
    }
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  return sql.join(conds, sql` AND `);
}

/** `GET /admin/part-requests`: active first, then newest; paged with the total (as the other admin lists). */
export async function listAdminPartRequests(conn: Conn, f: AdminPartRequestFilters): Promise<AdminPartRequestList> {
  const where = whereOf(f);
  const total = await conn.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM part_requests pr JOIN businesses b ON b.id = pr.business_id WHERE ${where}`);
  const { rows } = await conn.execute<AdminRowRaw>(sql`
    SELECT ${ADMIN_ROW_COLUMNS}
    FROM part_requests pr JOIN businesses b ON b.id = pr.business_id
    WHERE ${where}
    ORDER BY (pr.status = 'active') DESC, pr.created_at DESC, pr.id DESC
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`);
  return { rows: rows.map(toAdminRow), total: Number(total.rows[0]?.n ?? 0), page: f.page, pageSize: f.pageSize };
}

async function loadRow(conn: Conn, id: string) {
  const [row] = await conn.select().from(partRequests).where(eq(partRequests.id, id));
  if (!row) throw partRequestNotFound();
  return row;
}

/** `GET /admin/part-requests/:id` (`404 PART_REQUEST_NOT_FOUND`). */
export async function getAdminPartRequest(conn: Conn, id: string): Promise<AdminPartRequestDetail> {
  return adminDetailView(conn, await loadRow(conn, id));
}

/** `GET /admin/part-requests/:id/photos`: 300 s signed URLs to the private copies. */
export async function adminRequestPhotos(conn: Conn, id: string): Promise<PartRequestPhotos> {
  const row = await loadRow(conn, id);
  return { photos: await Promise.all(row.photoKeys.map((key) => privatePhotoUrl(key))) };
}

/**
 * `POST /admin/part-requests/:id/remove { reason }` (§9.1): any status but `removed` → `removed` (`return_status` = the
 * old status, `removed_by_admin_id`, `removed_reason`); pending replies dropped `request_removed` (sellers told); open
 * `part_request` reports → `actioned` with the reason; `part_request_removed` to the buyer (dedupe
 * `part_request_removed:<id>:<removed epoch>`); audit `part_request.remove` before / after status.
 */
export async function removePartRequest(
  app: TxApp,
  admin: { adminId: string },
  id: string,
  body: { reason: string },
): Promise<AdminPartRequestDetail> {
  const reason = adminText(body.reason);
  return runTx(app, async (tx) => {
    const row = await lockPartRequest(tx, id, 'no_key_update');
    if (!row) throw partRequestNotFound();
    const updated = await writeRequestStatus(tx, row, 'remove', { removedByAdminId: admin.adminId, removedReason: reason });
    const dropped = await dropPendingRepliesForRequest(tx, updated, 'request_removed');
    const actioned = await tx
      .update(reports)
      .set({ status: 'actioned', resolvedBy: admin.adminId, resolvedAt: sql`now()`, resolutionNote: reason })
      .where(
        and(
          sql`${reports.targetType} = 'part_request'`,
          eq(reports.targetId, id),
          inArray(reports.status, ['open', 'reviewing']),
        ),
      )
      .returning({ id: reports.id });
    await notify(tx, {
      type: 'part_request_removed',
      recipientBusinessId: updated.businessId,
      params: { requestTitle: maskedRequestName(updated.name) },
      destination: { partRequestId: updated.id },
      dedupeKey: `part_request_removed:${updated.id}:${Math.floor(updated.removedAt!.getTime() / 1000)}`,
    });
    await writeAudit(tx, {
      adminId: admin.adminId,
      action: 'part_request.remove',
      entityType: 'part_request',
      entityId: id,
      before: { status: row.status },
      after: { status: updated.status, reason, repliesDropped: dropped, reportsActioned: actioned.map((r) => r.id) },
    });
    return adminDetailView(tx, updated);
  });
}

/**
 * `POST /admin/part-requests/:id/restore { reason }` (§9.1, review Q8): `removed` → its `return_status` (an `active`
 * one past `expires_at` lands `expired`); the removal stamps are cleared (the audit log keeps them). No notification,
 * no open-limit check, no re-targeting or backfill (no work row). Audit `part_request.restore` before / after status.
 */
export async function restorePartRequest(
  app: TxApp,
  admin: { adminId: string },
  id: string,
  body: { reason: string },
): Promise<AdminPartRequestDetail> {
  const reason = adminText(body.reason);
  return runTx(app, async (tx) => {
    const row = await lockPartRequest(tx, id, 'no_key_update');
    if (!row) throw partRequestNotFound();
    const updated = await writeRequestStatus(tx, row, 'restore', {
      removedAt: null,
      removedByAdminId: null,
      removedReason: null,
    });
    await writeAudit(tx, {
      adminId: admin.adminId,
      action: 'part_request.restore',
      entityType: 'part_request',
      entityId: id,
      before: { status: row.status, removedReason: row.removedReason },
      after: { status: updated.status, reason },
    });
    return adminDetailView(tx, updated);
  });
}
