import { and, eq, ne, sql } from 'drizzle-orm';
import { FRAUD_EVIDENCE_MAX, type FraudEvidence, type FraudSignalKind } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { fraudSignals } from '../../db/schema.js';

/**
 * Raising advisory signals (admin close-out R8, §8.2 step 3; follows textile `raiseOrAppendFlag`). One open signal per
 * business and kind (partial unique index): new evidence is appended to it, items whose `key` is already on it are
 * skipped, the newest 50 are kept and `evidence_count` counts every item ever appended. Written only by the
 * `fraud-signals` job, which holds its advisory lock, so there is one writer; the open row is locked `FOR NO KEY UPDATE`
 * against an admin closing it at the same moment. No business row lock (signals are their own rows).
 */

type Conn = Db | Tx;

const byAt = (a: FraudEvidence, b: FraudEvidence): number => a.at.localeCompare(b.at);

export async function raiseOrAppend(
  tx: Tx,
  businessId: string,
  kind: FraudSignalKind,
  items: FraudEvidence[],
): Promise<{ signalId: string; added: number } | null> {
  if (items.length === 0) return null;
  const [open] = await tx
    .select({ id: fraudSignals.id, evidence: fraudSignals.evidence, evidenceCount: fraudSignals.evidenceCount })
    .from(fraudSignals)
    .where(and(eq(fraudSignals.businessId, businessId), eq(fraudSignals.kind, kind), eq(fraudSignals.status, 'open')))
    .for('no key update');

  // Re-read the latest close after the lock: an admin closing the signal after the evaluator read its window must not
  // be undone by evidence the close already spent (R8).
  const cutoff = await closedCutoff(tx, businessId, kind);
  const cutoffIso = cutoff ? cutoff.toISOString() : null;
  const seen = new Set((open?.evidence ?? []).map((e) => e.key));
  // Once items were dropped (more than 50 ever), an item no newer than the oldest kept one may be a dropped one: it
  // would be dropped again anyway, so it is skipped rather than counted twice.
  const floor =
    open && open.evidenceCount > open.evidence.length && open.evidence.length > 0
      ? open.evidence.reduce((min, e) => (e.at < min ? e.at : min), open.evidence[0]!.at)
      : null;
  const fresh: FraudEvidence[] = [];
  for (const item of [...items].sort(byAt)) {
    if (seen.has(item.key) || (floor !== null && item.at <= floor)) continue;
    if (cutoffIso !== null && new Date(item.at).toISOString() <= cutoffIso) continue;
    seen.add(item.key);
    fresh.push(item);
  }
  if (open && fresh.length === 0) return { signalId: open.id, added: 0 };
  if (fresh.length === 0) return null;

  const newest = new Date(fresh[fresh.length - 1]!.at);
  if (open) {
    await tx
      .update(fraudSignals)
      .set({
        evidence: [...open.evidence, ...fresh].sort(byAt).slice(-FRAUD_EVIDENCE_MAX),
        evidenceCount: sql`${fraudSignals.evidenceCount} + ${fresh.length}`,
        lastSeenAt: sql`GREATEST(${fraudSignals.lastSeenAt}, ${newest})`,
        updatedAt: sql`now()`,
      })
      .where(eq(fraudSignals.id, open.id));
    return { signalId: open.id, added: fresh.length };
  }
  const [created] = await tx
    .insert(fraudSignals)
    .values({
      businessId,
      kind,
      evidence: fresh.slice(-FRAUD_EVIDENCE_MAX),
      evidenceCount: fresh.length,
      firstSeenAt: new Date(fresh[0]!.at),
      lastSeenAt: newest,
    })
    .onConflictDoNothing()
    .returning({ id: fraudSignals.id });
  // Another writer opened one in between (not expected under the job lock): append to it instead.
  if (!created) return raiseOrAppend(tx, businessId, kind, items);
  return { signalId: created.id, added: fresh.length };
}

/**
 * When the latest signal of this business and kind was closed (`reviewed_at`), or null: the rules count only evidence
 * seen after it, so a new signal needs the full threshold again (R8, quiet reading).
 */
export async function closedCutoff(conn: Conn, businessId: string, kind: FraudSignalKind): Promise<Date | null> {
  const [row] = await conn
    .select({ at: sql<Date | string | null>`max(${fraudSignals.reviewedAt})` })
    .from(fraudSignals)
    .where(and(eq(fraudSignals.businessId, businessId), eq(fraudSignals.kind, kind), ne(fraudSignals.status, 'open')));
  return row?.at ? new Date(row.at) : null;
}
