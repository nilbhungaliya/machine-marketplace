import { and, eq, sql, type SQL } from 'drizzle-orm';
import type {
  AdminRole,
  FraudEvidence,
  FraudEvidenceView,
  FraudSignalDetail,
  FraudSignalKind,
  FraudSignalPage,
  FraudSignalRow,
  FraudSignalStatus,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { fraudSignals } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { runTx, type TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';

/**
 * AD6 fraud signals for staff (admin close-out §8.3; moderator, support): the list (open by default, newest evidence
 * first, server-paged), the detail with evidence refs resolved to names, and the review that closes a signal
 * (`dismissed` | `actioned` with a note; audit `fraud_signal.review`). Closing spends the evidence (R8): the rules count
 * only what is seen after `reviewed_at`. Signals are advisory and never change what users see.
 */

type Conn = Db | Tx;

interface SignalSqlRow extends Record<string, unknown> {
  id: string;
  business_id: string;
  trade_name: string;
  kind: FraudSignalKind;
  status: FraudSignalStatus;
  evidence_count: number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  reviewed_at: Date | string | null;
  reviewed_by_id: string | null;
  reviewed_by_name: string | null;
  note: string | null;
  evidence?: FraudEvidence[];
}

const iso = (d: Date | string): string => new Date(d).toISOString();

function toRow(r: SignalSqlRow): FraudSignalRow {
  return {
    id: r.id,
    business: { id: r.business_id, name: r.trade_name },
    kind: r.kind,
    status: r.status,
    evidenceCount: Number(r.evidence_count),
    firstSeenAt: iso(r.first_seen_at),
    lastSeenAt: iso(r.last_seen_at),
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
    reviewedBy: r.reviewed_by_id ? { id: r.reviewed_by_id, name: r.reviewed_by_name ?? '' } : null,
    note: r.note,
  };
}

async function querySignals(conn: Conn, where: SQL, tail: SQL, withEvidence = false): Promise<SignalSqlRow[]> {
  const { rows } = await conn.execute<SignalSqlRow>(sql`
    SELECT f.id, f.business_id, b.trade_name, f.kind, f.status, f.evidence_count, f.first_seen_at, f.last_seen_at,
           f.reviewed_at, a.id AS reviewed_by_id, a.name AS reviewed_by_name, f.note
           ${withEvidence ? sql`, f.evidence` : sql``}
      FROM fraud_signals f
      JOIN businesses b ON b.id = f.business_id
      LEFT JOIN admin_users a ON a.id = f.reviewed_by_admin_id
     WHERE ${where}
     ${tail}`);
  return rows;
}

const signalNotFound = () => new NotFoundError('Fraud signal');

export interface FraudSignalQuery {
  status?: FraudSignalStatus | 'all';
  kind?: FraudSignalKind;
  businessId?: string;
  page: number;
  pageSize: number;
}

/** `GET /admin/fraud-signals`: `open` by default (`all` for every status), newest evidence first. */
export async function listFraudSignals(conn: Conn, q: FraudSignalQuery): Promise<FraudSignalPage> {
  const parts: SQL[] = [];
  const status = q.status ?? 'open';
  if (status !== 'all') parts.push(sql`f.status = ${status}`);
  if (q.kind) parts.push(sql`f.kind = ${q.kind}`);
  if (q.businessId) parts.push(sql`f.business_id = ${q.businessId}::uuid`);
  const where = parts.length ? sql.join(parts, sql` AND `) : sql`true`;
  const offset = (q.page - 1) * q.pageSize;
  const [rows, count] = await Promise.all([
    querySignals(conn, where, sql`ORDER BY f.last_seen_at DESC, f.id DESC LIMIT ${q.pageSize} OFFSET ${offset}`),
    conn.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM fraud_signals f WHERE ${where}`),
  ]);
  return { rows: rows.map(toRow), total: Number(count.rows[0]?.n ?? 0), page: q.page, pageSize: q.pageSize };
}

/** `GET /admin/fraud-signals/:id`: the signal with its evidence (newest first), refs resolved to names. */
export async function getFraudSignal(conn: Conn, id: string): Promise<FraudSignalDetail> {
  const [row] = await querySignals(conn, sql`f.id = ${id}::uuid`, sql``, true);
  if (!row) throw signalNotFound();
  const evidence = [...(row.evidence ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const businessIds = [...new Set(evidence.flatMap((e) => e.refs.businessIds ?? []))];
  const userIds = [...new Set(evidence.flatMap((e) => e.refs.userIds ?? []))];
  const businessNames = new Map<string, string>();
  const userNames = new Map<string, { name: string; businessId: string }>();
  if (businessIds.length) {
    const { rows } = await conn.execute<{ id: string; name: string }>(
      sql`SELECT id, trade_name AS name FROM businesses WHERE id = ANY(${sql.param(businessIds)}::uuid[])`,
    );
    for (const r of rows) businessNames.set(r.id, r.name);
  }
  if (userIds.length) {
    const { rows } = await conn.execute<{ id: string; name: string | null; business_id: string | null }>(
      sql`SELECT id, name, business_id FROM users WHERE id = ANY(${sql.param(userIds)}::uuid[])`,
    );
    for (const r of rows) userNames.set(r.id, { name: r.name ?? '', businessId: r.business_id ?? '' });
  }
  const views: FraudEvidenceView[] = evidence.map((e) => ({
    key: e.key,
    at: e.at,
    summary: e.summary,
    groupId: e.refs.groupId ?? null,
    threadId: e.refs.threadId ?? null,
    messageId: e.refs.messageId ?? null,
    businesses: (e.refs.businessIds ?? []).filter((b) => businessNames.has(b)).map((b) => ({ id: b, name: businessNames.get(b)! })),
    users: (e.refs.userIds ?? []).filter((u) => userNames.has(u)).map((u) => ({ id: u, ...userNames.get(u)! })),
    reportIds: e.refs.reportIds ?? [],
  }));
  return { ...toRow(row), evidence: views };
}

/**
 * `POST /admin/fraud-signals/:id/review`: closes an open signal as `dismissed` or `actioned` with a note (3–500
 * characters, `adminText`); `409 FRAUD_SIGNAL_NOT_OPEN` when it is already closed. Audit `fraud_signal.review` with the
 * status before and after.
 */
export async function reviewFraudSignal(
  app: TxApp,
  admin: { adminId: string; role: AdminRole },
  id: string,
  input: { outcome: 'dismissed' | 'actioned'; note: string },
): Promise<FraudSignalRow> {
  const note = adminText(input.note, 'message');
  return runTx(app, async (tx) => {
    const [before] = await tx
      .select({ id: fraudSignals.id, status: fraudSignals.status, kind: fraudSignals.kind, businessId: fraudSignals.businessId })
      .from(fraudSignals)
      .where(eq(fraudSignals.id, id))
      .for('no key update');
    if (!before) throw signalNotFound();
    if (before.status !== 'open') throw new ConflictError('This signal is already closed', 'FRAUD_SIGNAL_NOT_OPEN');
    await tx
      .update(fraudSignals)
      .set({ status: input.outcome, reviewedByAdminId: admin.adminId, reviewedAt: sql`now()`, note, updatedAt: sql`now()` })
      .where(and(eq(fraudSignals.id, id), eq(fraudSignals.status, 'open')));
    await writeAudit(tx, {
      adminId: admin.adminId,
      action: 'fraud_signal.review',
      entityType: 'fraud_signal',
      entityId: id,
      before: { status: before.status, kind: before.kind, businessId: before.businessId },
      after: { status: input.outcome, note },
    });
    const [row] = await querySignals(tx, sql`f.id = ${id}::uuid`, sql``);
    return toRow(row!);
  });
}

/** A business's open fraud signals for its admin detail page (admin close-out §7.3), newest evidence first. */
export async function openSignalsForBusiness(conn: Conn, businessId: string): Promise<FraudSignalRow[]> {
  const rows = await querySignals(
    conn,
    sql`f.business_id = ${businessId}::uuid AND f.status = 'open'`,
    sql`ORDER BY f.last_seen_at DESC, f.id DESC`,
  );
  return rows.map(toRow);
}
