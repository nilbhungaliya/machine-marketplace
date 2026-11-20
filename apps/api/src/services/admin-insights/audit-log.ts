import { sql, type SQL } from 'drizzle-orm';
import { EXPORT_PAGE_SIZE, type AuditLogDetail, type AuditLogFacets, type AuditLogPage, type AuditLogRow } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { CsvCell } from '../../lib/csv.js';
import { NotFoundError } from '../../lib/errors.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';
import type { CsvExportSpec } from '../exports/run-export.js';
import { istMinute } from '../exports/format.js';
import { auditHref, auditLabel } from './audit-labels.js';
import { changedKeys, maskSnapshot } from './audit-mask.js';

/**
 * The audit log viewer (admin close-out §11.3, R16; ported from textile `services/admin-insights/audit-log.ts`).
 * Read-only: no route edits or deletes a row. Newest first by `(created_at, id)`, numbered pages. The detail's
 * `before` / `after` are masked (`maskSnapshot`); `revealAuditEntry` returns one entry unmasked and writes an
 * `audit.reveal` row naming it (never the values). The CSV export carries no snapshot.
 */

export interface AuditLogQuery {
  /** IST days, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  adminId?: string;
  /** `system`: entries with no admin. */
  actor?: 'system';
  /** Exact, or a prefix when it ends in `.` (`listing.`). */
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Part of the entity label, or the entity id. */
  q?: string;
}

const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

type Row = {
  id: string;
  created_at: Date;
  micros: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  admin_id: string | null;
  admin_name: string | null;
  entity_label: string | null;
  before: unknown;
  after: unknown;
};

/** The entity's id as a uuid when it is one (entity ids are text: some are keys or sheet names). */
const ENTITY_UUID = sql`(CASE WHEN a.entity_id ~ ${UUID_RE} THEN a.entity_id::uuid END)`;

/** One row per audit entry with its admin's name and its entity's label. Filter on the outer query's columns. */
const BASE = sql`
  SELECT a.id, a.created_at, floor(extract(epoch from a.created_at) * 1000000)::bigint::text AS micros,
         a.action, a.entity_type, a.entity_id, a.admin_id, adm.name AS admin_name, a.before, a.after,
         CASE a.entity_type
           WHEN 'listing' THEN '#' || l.ref || COALESCE(' ' || l.title, '')
           WHEN 'business' THEN b.trade_name
           WHEN 'deal' THEN '#' || d.ref
           WHEN 'rental_booking' THEN '#' || rb.ref
           WHEN 'part_request' THEN '#' || pr.ref
           WHEN 'category' THEN c.name
           WHEN 'brand' THEN br.name
           WHEN 'model' THEN m.name
           WHEN 'admin_user' THEN au.name
         END AS entity_label
    FROM audit_log a
    LEFT JOIN admin_users adm ON adm.id = a.admin_id
    LEFT JOIN listings l ON a.entity_type = 'listing' AND l.id = ${ENTITY_UUID}
    LEFT JOIN businesses b ON a.entity_type = 'business' AND b.id = ${ENTITY_UUID}
    LEFT JOIN deals d ON a.entity_type = 'deal' AND d.id = ${ENTITY_UUID}
    LEFT JOIN rental_bookings rb ON a.entity_type = 'rental_booking' AND rb.id = ${ENTITY_UUID}
    LEFT JOIN part_requests pr ON a.entity_type = 'part_request' AND pr.id = ${ENTITY_UUID}
    LEFT JOIN categories c ON a.entity_type = 'category' AND c.id = ${ENTITY_UUID}
    LEFT JOIN brands br ON a.entity_type = 'brand' AND br.id = ${ENTITY_UUID}
    LEFT JOIN machine_models m ON a.entity_type = 'model' AND m.id = ${ENTITY_UUID}
    LEFT JOIN admin_users au ON a.entity_type = 'admin_user' AND au.id = ${ENTITY_UUID}`;

function toRow(r: Row): AuditLogRow {
  return {
    id: r.id,
    at: new Date(r.created_at).toISOString(),
    admin: r.admin_id === null ? null : { id: r.admin_id, name: r.admin_name ?? '' },
    action: r.action,
    label: auditLabel(r.action),
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    href: auditHref(r.entity_type, r.entity_id),
  };
}

function likePattern(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereParts(q: AuditLogQuery): SQL[] {
  const where: SQL[] = [];
  if (q.from) where.push(sql`x.created_at >= ((${q.from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  if (q.to) where.push(sql`x.created_at < (((${q.to}::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`);
  if (q.adminId) where.push(sql`x.admin_id = ${q.adminId}::uuid`);
  if (q.actor === 'system') where.push(sql`x.admin_id IS NULL`);
  if (q.action) {
    where.push(q.action.endsWith('.') ? sql`x.action LIKE ${`${likePattern(q.action)}%`}` : sql`x.action = ${q.action}`);
  }
  if (q.entityType) where.push(sql`x.entity_type = ${q.entityType}`);
  if (q.entityId) where.push(sql`x.entity_id = ${q.entityId}`);
  if (q.q) where.push(sql`(x.entity_label ILIKE ${`%${likePattern(q.q)}%`} OR x.entity_id = ${q.q})`);
  return where;
}

function whereSql(parts: SQL[]): SQL {
  return parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

export async function listAuditLog(
  conn: Db | Tx,
  q: AuditLogQuery & { page: number; pageSize: number },
): Promise<AuditLogPage> {
  const where = whereSql(whereParts(q));
  const { rows } = await conn.execute<Row>(sql`
    SELECT x.* FROM (${BASE}) x
    ${where}
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);
  const { rows: counted } = await conn.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${BASE}) x ${where}`);
  return { rows: rows.map(toRow), total: counted[0]!.n, page: q.page, pageSize: q.pageSize };
}

/** The filters' choices: actions and entity types present, and every admin. */
export async function auditFacets(conn: Db | Tx): Promise<AuditLogFacets> {
  const { rows: actions } = await conn.execute<{ action: string }>(sql`SELECT DISTINCT action FROM audit_log ORDER BY action`);
  const { rows: types } = await conn.execute<{ entity_type: string }>(
    sql`SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type`,
  );
  const { rows: admins } = await conn.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM admin_users ORDER BY name, id`,
  );
  return {
    actions: actions.map((r) => ({ action: r.action, label: auditLabel(r.action) })),
    entityTypes: types.map((r) => r.entity_type),
    admins: admins.map((r) => ({ id: r.id, name: r.name })),
  };
}

async function readEntry(conn: Db | Tx, id: string): Promise<Row> {
  if (!new RegExp(UUID_RE).test(id)) throw new NotFoundError('Audit entry');
  const { rows } = await conn.execute<Row>(sql`SELECT x.* FROM (${BASE}) x WHERE x.id = ${id}::uuid`);
  if (!rows[0]) throw new NotFoundError('Audit entry');
  return rows[0];
}

function toDetail(r: Row, reveal: boolean): AuditLogDetail {
  return {
    ...toRow(r),
    before: reveal ? r.before : maskSnapshot(r.before),
    after: reveal ? r.after : maskSnapshot(r.after),
    changedKeys: changedKeys(r.before, r.after),
    masked: !reveal,
  };
}

/** One entry, masked. */
export async function getAuditEntry(conn: Db | Tx, id: string): Promise<AuditLogDetail> {
  return toDetail(await readEntry(conn, id), false);
}

/** "Show hidden values": the entry unmasked, and an `audit.reveal` row naming it (its action only, never the values). */
export async function revealAuditEntry(app: TxApp, adminId: string, id: string): Promise<AuditLogDetail> {
  return runTx(app, async (tx) => {
    const row = await readEntry(tx, id);
    await writeAudit(tx, {
      adminId,
      action: 'audit.reveal',
      entityType: 'audit_log',
      entityId: id,
      before: null,
      after: { action: row.action },
    });
    return toDetail(row, true);
  });
}

export const AUDIT_EXPORT_HEADER = ['Time (IST)', 'Admin', 'Action', 'Label', 'Entity type', 'Entity id', 'Entity label', 'Link'];

type Cursor = { micros: string; id: string };

/**
 * The filtered list as a CSV export spec for `runCsvExport` (R16: no before / after column, no snapshot value), keyset
 * pages of `EXPORT_PAGE_SIZE` newest first.
 */
export function auditExportSpec(conn: Db | Tx, adminId: string, q: AuditLogQuery): CsvExportSpec<Cursor> {
  const parts = whereParts(q);
  const where = whereSql(parts);
  return {
    adminId,
    sheet: 'audit_log',
    filters: { ...q },
    header: AUDIT_EXPORT_HEADER,
    async count() {
      const { rows } = await conn.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${BASE}) x ${where}`);
      return rows[0]!.n;
    },
    async page(after) {
      const filter = after
        ? whereSql([
            ...parts,
            sql`(x.created_at, x.id) < (timestamptz 'epoch' + ${after.micros}::bigint * interval '1 microsecond', ${after.id}::uuid)`,
          ])
        : where;
      const { rows } = await conn.execute<Row>(sql`
        SELECT x.* FROM (${BASE}) x
        ${filter}
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT ${EXPORT_PAGE_SIZE}`);
      const cells = rows.map((r): CsvCell[] => [
        istMinute(r.created_at),
        r.admin_id === null ? 'System' : (r.admin_name ?? ''),
        r.action,
        auditLabel(r.action),
        r.entity_type,
        r.entity_id,
        r.entity_label,
        auditHref(r.entity_type, r.entity_id),
      ]);
      const last = rows[rows.length - 1];
      return { rows: cells, next: rows.length === EXPORT_PAGE_SIZE && last ? { micros: last.micros, id: last.id } : null };
    },
  };
}
