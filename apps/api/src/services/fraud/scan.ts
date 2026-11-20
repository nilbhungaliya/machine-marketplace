import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { contactSightings, fraudScanState } from '../../db/schema.js';
import { findPhones, phoneKey } from '../../lib/mask-contact.js';
import type { TxApp } from '../../lib/tx-effects.js';
import { paymentDetailKinds } from '../chat/scam-patterns.js';
import { reportAgainstSql } from '../reports/report-subject.js';
import { hmacPhone } from './hash.js';

/**
 * The fraud scan's windows (admin close-out §8.2, R9a). Every source reads only rows older than `now() − 2 minutes`
 * (the commit-lag margin) from its own watermark in `fraud_scan_state`: `last_seq` for chat messages, `last_at` for the
 * others; a missing row starts 30 days back. A scan never advances its watermark: it returns the mark it reached and
 * the job calls `advanceScan` once every evaluation of the run has succeeded (plan D9), so a failed run re-reads the
 * same window (sightings are unique per message and phone, evidence keys dedupe).
 */

type Conn = Db | Tx;

export type ScanRule = 'chat_messages' | 'install_sightings' | 'new_account_burst' | 'reports_against';
export type TimeScanRule = Exclude<ScanRule, 'chat_messages'>;

export const SCAN_MARGIN = sql`now() - interval '2 minutes'`;
const FIRST_RUN_FROM = sql`now() - interval '30 days'`;
export const CHAT_SCAN_LIMIT = 5_000;

interface ScanMessageRow extends Record<string, unknown> {
  id: string;
  seq: string | number;
  thread_id: string;
  sender_side: string | null;
  text: string | null;
  created_at: Date | string;
  young: boolean;
  business_id: string | null;
}

/**
 * Scans chat messages past the `chat_messages` watermark (§8.2 step 2): up to `limit` rows in `seq` order, taking only
 * the unbroken run below the first row whose `created_at` is inside the 2-minute margin (it stops there and never jumps
 * past it, so a message from a transaction that committed late is still above the watermark next run). For user
 * messages with text (`sender_side` set): with a `key`, inserts a `contact_sightings` row (HMAC only) per number found
 * that is not the sender business's contact phone or any of its members' login phones (`ON CONFLICT (message_id,
 * phone_hmac) DO NOTHING`); the sender's business is touched for any such number or any payment-detail match. No key:
 * no sightings, payment senders still touched. `mark` is the highest `seq` taken (null when none); nothing is advanced.
 */
export async function scanChatMessages(
  app: TxApp,
  opts: { key: string | null; limit?: number },
): Promise<{ scanned: number; touched: Set<string>; mark: { lastSeq: number } | null }> {
  const conn = app.db;
  const limit = opts.limit ?? CHAT_SCAN_LIMIT;
  const [state] = await conn.select({ lastSeq: fraudScanState.lastSeq }).from(fraudScanState).where(sql`${fraudScanState.rule} = 'chat_messages'`);
  let lastSeq: number;
  if (state?.lastSeq != null) {
    lastSeq = Number(state.lastSeq);
  } else {
    const { rows } = await conn.execute<{ seq: string | number | null }>(
      sql`SELECT max(seq) AS seq FROM chat_messages WHERE created_at <= ${FIRST_RUN_FROM}`,
    );
    lastSeq = Number(rows[0]?.seq ?? 0);
  }

  const { rows } = await conn.execute<ScanMessageRow>(sql`
    SELECT m.id, m.seq, m.thread_id, m.sender_side, m.text, m.created_at,
           (m.created_at > ${SCAN_MARGIN}) AS young,
           CASE m.sender_side WHEN 'buyer' THEN t.buyer_business_id WHEN 'seller' THEN t.seller_business_id END AS business_id
      FROM chat_messages m
      JOIN chat_threads t ON t.id = m.thread_id
     WHERE m.seq > ${lastSeq}
     ORDER BY m.seq
     LIMIT ${limit}`);

  const taken: ScanMessageRow[] = [];
  for (const row of rows) {
    if (row.young) break;
    taken.push(row);
  }
  const touched = new Set<string>();
  if (taken.length === 0) return { scanned: 0, touched, mark: null };

  const userRows = taken.filter((r) => r.sender_side != null && r.text != null && r.business_id != null);
  const ownPhones = opts.key ? await ownPhonesOf(conn, [...new Set(userRows.map((r) => r.business_id!))]) : new Map<string, Set<string>>();
  const sightings: (typeof contactSightings.$inferInsert)[] = [];
  for (const row of userRows) {
    const text = row.text!;
    const businessId = row.business_id!;
    if (paymentDetailKinds(text).length > 0) touched.add(businessId);
    if (!opts.key) continue;
    const own = ownPhones.get(businessId) ?? new Set<string>();
    for (const phone of findPhones(text)) {
      if (own.has(phone)) continue;
      touched.add(businessId);
      sightings.push({
        phoneHmac: hmacPhone(phone, opts.key),
        businessId,
        threadId: row.thread_id,
        messageId: row.id,
        seenAt: new Date(row.created_at),
      });
    }
  }
  for (let i = 0; i < sightings.length; i += 500) {
    await conn.insert(contactSightings).values(sightings.slice(i, i + 500)).onConflictDoNothing();
  }
  const highest = taken.reduce((max, r) => Math.max(max, Number(r.seq)), lastSeq);
  return { scanned: taken.length, touched, mark: { lastSeq: highest } };
}

/** Each business's own phones as last-10-digit keys: its contact phone and every member's login phone. */
async function ownPhonesOf(conn: Conn, businessIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (businessIds.length === 0) return out;
  const { rows } = await conn.execute<{ id: string; phone: string | null }>(sql`
    SELECT b.id, b.contact_phone AS phone FROM businesses b WHERE b.id = ANY(${sql.param(businessIds)}::uuid[])
    UNION ALL
    SELECT u.business_id, u.phone FROM users u WHERE u.business_id = ANY(${sql.param(businessIds)}::uuid[])`);
  for (const r of rows) {
    const key = r.phone ? phoneKey(r.phone) : null;
    if (!key) continue;
    const set = out.get(r.id) ?? new Set<string>();
    set.add(key);
    out.set(r.id, set);
  }
  return out;
}

/** A business touched by a time-watermarked source, with the newest timestamp seen for it. */
export interface ScanRow {
  businessId: string;
  at: Date;
}

/**
 * Per source: the rows' timestamp and the business they touch (null rows still count towards the mark). `from` is the
 * watermark as Postgres text (full microsecond precision), so the row at the mark is not read again.
 */
function sourceSql(rule: TimeScanRule, from: string): ReturnType<typeof sql> {
  const inWindow = (col: ReturnType<typeof sql.raw>) => sql`${col} > ${from}::timestamptz AND ${col} <= ${SCAN_MARGIN}`;
  switch (rule) {
    case 'install_sightings':
      return sql`
        SELECT u.business_id, s.last_seen_at AS at
          FROM install_sightings s JOIN users u ON u.id = s.user_id
         WHERE ${inWindow(sql.raw('s.last_seen_at'))}
        UNION ALL
        -- A user signs in (the sighting) before onboarding creates their business: the business touches the rule when
        -- it is created, so the other businesses on that install are evaluated too.
        SELECT b.id AS business_id, b.created_at AS at
          FROM businesses b
         WHERE ${inWindow(sql.raw('b.created_at'))}
           AND EXISTS (SELECT 1 FROM users u JOIN install_sightings s ON s.user_id = u.id WHERE u.business_id = b.id)`;
    case 'new_account_burst':
      // Threads a business started as the buyer and its replies to part requests; the evaluator checks the age.
      return sql`
        SELECT t.buyer_business_id AS business_id, t.created_at AS at
          FROM chat_threads t
         WHERE ${inWindow(sql.raw('t.created_at'))}
        UNION ALL
        SELECT pr.seller_business_id AS business_id, pr.created_at AS at
          FROM part_request_replies pr
         WHERE ${inWindow(sql.raw('pr.created_at'))}`;
    case 'reports_against':
      return sql`
        SELECT ${reportAgainstSql('r')} AS business_id, r.created_at AS at
          FROM reports r
         WHERE ${inWindow(sql.raw('r.created_at'))}`;
  }
}

/**
 * Reads a time-watermarked source (§8.2): rows with their timestamp `> last_at` (first run: 30 days back) and `≤ now()
 * − 2 minutes`, grouped by the business they touch. `mark` is the newest timestamp actually taken (any row, also one
 * touching no business), null when nothing was; it is not the window's end, so a row committing late inside the margin
 * is still read next run.
 */
export async function scanSince(conn: Conn, rule: TimeScanRule): Promise<{ from: string; rows: ScanRow[]; mark: string | null }> {
  // Timestamps travel as Postgres text: a JS Date drops the microseconds, and the row at the mark would be read again.
  const { rows: state } = await conn.execute<{ from: string }>(sql`
    SELECT coalesce((SELECT last_at FROM fraud_scan_state WHERE rule = ${rule}), ${FIRST_RUN_FROM})::text AS from`);
  const from = state[0]!.from;
  const { rows } = await conn.execute<{ business_id: string | null; at: Date | string; mark: string }>(sql`
    SELECT src.business_id, max(src.at) AS at, (max(max(src.at)) OVER ())::text AS mark
      FROM (${sourceSql(rule, from)}) src GROUP BY src.business_id`);
  const out: ScanRow[] = [];
  for (const r of rows) if (r.business_id) out.push({ businessId: r.business_id, at: new Date(r.at) });
  return { from, rows: out, mark: rows[0]?.mark ?? null };
}

/**
 * Moves a watermark (§8.2 step 4), only forward: `last_seq` for `chat_messages`, `last_at` for the others. The job
 * calls it in one transaction after every evaluation of the run succeeded.
 */
export async function advanceScan(tx: Conn, rule: ScanRule, mark: number | Date | string): Promise<void> {
  if (rule === 'chat_messages') {
    if (typeof mark !== 'number') throw new Error('advanceScan: chat_messages takes a seq');
    await tx
      .insert(fraudScanState)
      .values({ rule, lastSeq: mark })
      .onConflictDoUpdate({
        target: fraudScanState.rule,
        set: { lastSeq: sql`GREATEST(coalesce(${fraudScanState.lastSeq}, 0), excluded.last_seq)`, updatedAt: sql`now()` },
      });
    return;
  }
  if (typeof mark === 'number') throw new Error(`advanceScan: ${rule} takes a timestamp`);
  const at = mark instanceof Date ? mark.toISOString() : mark;
  await tx
    .insert(fraudScanState)
    .values({ rule, lastAt: sql`${at}::timestamptz` })
    .onConflictDoUpdate({
      target: fraudScanState.rule,
      set: {
        lastAt: sql`GREATEST(coalesce(${fraudScanState.lastAt}, excluded.last_at), excluded.last_at)`,
        updatedAt: sql`now()`,
      },
    });
}
