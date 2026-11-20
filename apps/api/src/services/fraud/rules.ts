import { sql, type SQL } from 'drizzle-orm';
import type { AppSettingsValues, FraudEvidence, FraudSignalKind, PaymentMatchKind } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import type { TxApp } from '../../lib/tx-effects.js';
import { paymentDetailKinds } from '../chat/scam-patterns.js';
import { reportAgainstSql } from '../reports/report-subject.js';
import { groupIdOf } from './hash.js';
import { raiseOrAppend } from './signals.js';

/**
 * The five fraud rules (admin close-out §8.1, R9). Each evaluator takes the businesses the scan touched and runs one
 * short transaction per business: it counts only evidence after `since` = the later of the window start and the
 * latest close of a signal of that business and kind (R8, quiet reading: a closed signal spends its evidence, so a new
 * one needs the full threshold again), then `raiseOrAppend`s the evidence with its plan D16 key. Evidence holds refs,
 * times, match kinds and counts only: never a phone number, an install id or message text. Re-running an evaluator
 * over the same rows appends nothing (keys dedupe). The job calls them through `FRAUD_EVALUATORS`.
 */

type Settings = AppSettingsValues;
export type FraudEvaluator = (app: TxApp, businessIds: string[], settings: Settings, key?: string | null) => Promise<void>;

const windowStart = (days: number): SQL => sql`now() - make_interval(days => ${days}::int)`;

/** The later of the window start and the latest close of this business's signal of `kind` (GREATEST skips null). */
function sinceSql(businessId: string, kind: FraudSignalKind, windowDays: number | null): SQL {
  const closed = sql`(SELECT max(fs.reviewed_at) FROM fraud_signals fs
    WHERE fs.business_id = ${businessId}::uuid AND fs.kind = ${kind} AND fs.status <> 'open')`;
  return windowDays == null
    ? sql`coalesce(${closed}, '-infinity'::timestamptz)`
    : sql`GREATEST(${windowStart(windowDays)}, ${closed})`;
}

const iso = (d: Date | string): string => new Date(d).toISOString();
const unique = (ids: string[]): string[] => [...new Set(ids)];

/** One transaction per business (a failure stops the evaluator: the job then leaves the watermarks where they were). */
async function perBusiness(app: TxApp, businessIds: string[], fn: (tx: Tx, businessId: string) => Promise<void>): Promise<void> {
  for (const businessId of unique(businessIds)) {
    await app.db.transaction((tx) => fn(tx, businessId));
  }
}

// ─── shared_device ───

/**
 * ≥ `fraud_device_accounts` distinct businesses (members of one business count once) signed in on one install in the
 * window: a signal on each of them. Also evaluates the other businesses on the touched businesses' installs.
 */
export const evaluateSharedDevice: FraudEvaluator = async (app, businessIds, settings) => {
  if (businessIds.length === 0) return;
  const days = settings.fraud_window_days;
  const { rows: peers } = await app.db.execute<{ business_id: string }>(sql`
    SELECT DISTINCT u2.business_id
      FROM install_sightings s1
      JOIN users u1 ON u1.id = s1.user_id
      JOIN install_sightings s2 ON s2.install_hash = s1.install_hash
      JOIN users u2 ON u2.id = s2.user_id
     WHERE u1.business_id = ANY(${sql.param(unique(businessIds))}::uuid[])
       AND s1.last_seen_at > ${windowStart(days)} AND s2.last_seen_at > ${windowStart(days)}
       AND u2.business_id IS NOT NULL`);
  const all = unique([...businessIds, ...peers.map((p) => p.business_id)]);
  await perBusiness(app, all, async (tx, businessId) => {
    const { rows } = await tx.execute<{ install_hash: string; business_id: string; user_id: string; last_seen_at: Date | string }>(sql`
      WITH mine AS (
        SELECT DISTINCT s.install_hash FROM install_sightings s JOIN users u ON u.id = s.user_id
         WHERE u.business_id = ${businessId}::uuid AND s.last_seen_at > ${windowStart(days)})
      SELECT s.install_hash, u.business_id, u.id AS user_id, s.last_seen_at
        FROM install_sightings s
        JOIN users u ON u.id = s.user_id
        JOIN mine ON mine.install_hash = s.install_hash
       WHERE u.business_id IS NOT NULL AND s.last_seen_at > ${sinceSql(businessId, 'shared_device', days)}`);
    const byHash = new Map<string, typeof rows>();
    for (const r of rows) byHash.set(r.install_hash, [...(byHash.get(r.install_hash) ?? []), r]);
    const items: FraudEvidence[] = [];
    for (const [hash, hashRows] of byHash) {
      const businessesOnIt = unique(hashRows.map((r) => r.business_id));
      if (businessesOnIt.length < settings.fraud_device_accounts) continue;
      const groupId = groupIdOf(hash);
      for (const other of businessesOnIt.filter((b) => b !== businessId)) {
        const otherRows = hashRows.filter((r) => r.business_id === other);
        const at = otherRows.reduce((max, r) => (iso(r.last_seen_at) > max ? iso(r.last_seen_at) : max), '');
        items.push({
          key: `device:${groupId}:${other}`,
          at,
          summary: `${businessesOnIt.length} businesses signed in on one app install`,
          refs: { businessIds: [other], userIds: unique(otherRows.map((r) => r.user_id)), groupId },
        });
      }
    }
    await raiseOrAppend(tx, businessId, 'shared_device', items);
  });
};

// ─── repeated_phone ───

/**
 * One phone (as its HMAC) posted in chat by ≥ `fraud_phone_businesses` businesses (a signal on each), or by one
 * business in ≥ `fraud_phone_threads` threads, in the window. The sender's own phones were never stored (scan). Off
 * without `SIGNAL_HASH_KEY`. Also evaluates the other businesses that posted the touched businesses' numbers.
 */
export const evaluateRepeatedPhone: FraudEvaluator = async (app, businessIds, settings, key) => {
  if (!key || businessIds.length === 0) return;
  const days = settings.fraud_window_days;
  const { rows: peers } = await app.db.execute<{ business_id: string }>(sql`
    SELECT DISTINCT c2.business_id
      FROM contact_sightings c1
      JOIN contact_sightings c2 ON c2.phone_hmac = c1.phone_hmac
     WHERE c1.business_id = ANY(${sql.param(unique(businessIds))}::uuid[])
       AND c1.seen_at > ${windowStart(days)} AND c2.seen_at > ${windowStart(days)}`);
  const all = unique([...businessIds, ...peers.map((p) => p.business_id)]);
  await perBusiness(app, all, async (tx, businessId) => {
    const { rows } = await tx.execute<{ phone_hmac: string; business_id: string; thread_id: string; message_id: string; seen_at: Date | string }>(sql`
      WITH mine AS (
        SELECT DISTINCT phone_hmac FROM contact_sightings
         WHERE business_id = ${businessId}::uuid AND seen_at > ${windowStart(days)})
      SELECT c.phone_hmac, c.business_id, c.thread_id, c.message_id, c.seen_at
        FROM contact_sightings c JOIN mine ON mine.phone_hmac = c.phone_hmac
       WHERE c.seen_at > ${sinceSql(businessId, 'repeated_phone', days)}
       ORDER BY c.seen_at`);
    const byPhone = new Map<string, typeof rows>();
    for (const r of rows) byPhone.set(r.phone_hmac, [...(byPhone.get(r.phone_hmac) ?? []), r]);
    const items: FraudEvidence[] = [];
    for (const [hmac, phoneRows] of byPhone) {
      const businessCount = unique(phoneRows.map((r) => r.business_id)).length;
      const ownRows = phoneRows.filter((r) => r.business_id === businessId);
      const threadCount = unique(ownRows.map((r) => r.thread_id)).length;
      const byBusinesses = businessCount >= settings.fraud_phone_businesses;
      const byThreads = threadCount >= settings.fraud_phone_threads;
      if (!byBusinesses && !byThreads) continue;
      const groupId = groupIdOf(hmac);
      const summary = byBusinesses
        ? `One number posted by ${businessCount} businesses`
        : `One number posted in ${threadCount} conversations`;
      for (const r of byBusinesses ? phoneRows : ownRows) {
        items.push({
          key: `phone:${r.message_id}`,
          at: iso(r.seen_at),
          summary,
          refs: { threadId: r.thread_id, messageId: r.message_id, businessIds: [r.business_id], groupId },
        });
      }
    }
    await raiseOrAppend(tx, businessId, 'repeated_phone', items);
  });
};

// ─── payment_details ───

/** At most this many of a business's newest messages are re-read per run. */
const PAYMENT_READ_LIMIT = 5_000;

/**
 * ≥ `fraud_payment_messages` of the business's own user messages in the window (after the latest close) carry payment
 * details (`paymentDetailKinds`). The messages are re-read each time: no stored matches, no in-memory map.
 */
export const evaluatePaymentDetails: FraudEvaluator = async (app, businessIds, settings) => {
  const days = settings.fraud_window_days;
  await perBusiness(app, businessIds, async (tx, businessId) => {
    const { rows } = await tx.execute<{ id: string; thread_id: string; text: string; created_at: Date | string }>(sql`
      SELECT m.id, m.thread_id, m.text, m.created_at
        FROM chat_messages m
        JOIN chat_threads t ON t.id = m.thread_id
       WHERE m.text IS NOT NULL
         AND ((t.buyer_business_id = ${businessId}::uuid AND m.sender_side = 'buyer')
           OR (t.seller_business_id = ${businessId}::uuid AND m.sender_side = 'seller'))
         AND m.created_at > ${sinceSql(businessId, 'payment_details', days)}
       ORDER BY m.created_at DESC
       LIMIT ${PAYMENT_READ_LIMIT}`);
    const matches: { id: string; threadId: string; at: string; kinds: PaymentMatchKind[] }[] = [];
    for (const r of rows) {
      const kinds = paymentDetailKinds(r.text);
      if (kinds.length > 0) matches.push({ id: r.id, threadId: r.thread_id, at: iso(r.created_at), kinds });
    }
    if (matches.length < settings.fraud_payment_messages) return;
    await raiseOrAppend(
      tx,
      businessId,
      'payment_details',
      matches.map((m) => ({
        key: `pay:${m.id}`,
        at: m.at,
        summary: `Payment details in a message: ${m.kinds.join(', ')}`,
        refs: { threadId: m.threadId, messageId: m.id },
      })),
    );
  });
};

// ─── new_account_burst ───

const DAY_MS = 86_400_000;

/**
 * A business created ≤ `fraud_new_account_days` ago that started threads with (as the buyer) or replied to the part
 * requests of ≥ `fraud_burst_contacts` distinct businesses within any 24 hours. Evidence: every contact inside a
 * qualifying 24-hour window.
 */
export const evaluateNewAccountBurst: FraudEvaluator = async (app, businessIds, settings) => {
  await perBusiness(app, businessIds, async (tx, businessId) => {
    const { rows: age } = await tx.execute<{ young: boolean }>(sql`
      SELECT created_at > now() - make_interval(days => ${settings.fraud_new_account_days}::int) AS young
        FROM businesses WHERE id = ${businessId}::uuid`);
    if (!age[0]?.young) return;
    const since = sinceSql(businessId, 'new_account_burst', null);
    const { rows } = await tx.execute<{ src: 'thread' | 'reply'; id: string; other: string; at: Date | string }>(sql`
      SELECT 'thread' AS src, t.id, t.seller_business_id AS other, t.created_at AS at
        FROM chat_threads t
       WHERE t.buyer_business_id = ${businessId}::uuid AND t.created_at > ${since}
      UNION ALL
      SELECT 'reply' AS src, r.id, pr.business_id AS other, r.created_at AS at
        FROM part_request_replies r JOIN part_requests pr ON pr.id = r.part_request_id
       WHERE r.seller_business_id = ${businessId}::uuid AND r.created_at > ${since}
      ORDER BY at`);
    const events = rows
      .filter((r) => r.other !== businessId)
      .map((r) => ({ ...r, ms: new Date(r.at).getTime() }));
    const inBurst = new Map<string, { event: (typeof events)[number]; count: number }>();
    for (let i = 0; i < events.length; i++) {
      const start = events[i]!.ms;
      const windowEvents = events.filter((e) => e.ms >= start && e.ms <= start + DAY_MS);
      const count = new Set(windowEvents.map((e) => e.other)).size;
      if (count < settings.fraud_burst_contacts) continue;
      for (const e of windowEvents) {
        const prev = inBurst.get(e.id);
        if (!prev || prev.count < count) inBurst.set(e.id, { event: e, count });
      }
    }
    await raiseOrAppend(
      tx,
      businessId,
      'new_account_burst',
      [...inBurst.values()].map(({ event, count }) => ({
        key: `burst:${event.id}`,
        at: iso(event.at),
        summary: `New account contacted ${count} businesses within 24 hours`,
        refs: event.src === 'thread' ? { threadId: event.id, businessIds: [event.other] } : { businessIds: [event.other] },
      })),
    );
  });
};

// ─── reports_against ───

/**
 * ≥ `fraud_reports_against` reports with status `open`, `reviewing` or `actioned` (never `dismissed`) from distinct
 * businesses in the window, against the business or anything it owns (`reportAgainstSql`: a conversation report counts
 * against the other business in the thread, never the reporter).
 */
export const evaluateReportsAgainst: FraudEvaluator = async (app, businessIds, settings) => {
  const days = settings.fraud_window_days;
  await perBusiness(app, businessIds, async (tx, businessId) => {
    const { rows } = await tx.execute<{ id: string; target_type: string; target_id: string; reporter_business_id: string; created_at: Date | string }>(sql`
      SELECT r.id, r.target_type, r.target_id, r.reporter_business_id, r.created_at
        FROM reports r
       WHERE r.created_at > ${sinceSql(businessId, 'reports_against', days)}
         AND r.status IN ('open', 'reviewing', 'actioned')
         AND r.reporter_business_id IS NOT NULL AND r.reporter_business_id <> ${businessId}::uuid
         AND ${reportAgainstSql('r')} = ${businessId}::uuid`);
    const reporters = unique(rows.map((r) => r.reporter_business_id));
    if (reporters.length < settings.fraud_reports_against) return;
    await raiseOrAppend(
      tx,
      businessId,
      'reports_against',
      rows.map((r) => ({
        key: `report:${r.id}`,
        at: iso(r.created_at),
        summary: `Reported by another business (${r.target_type.replace('_', ' ')})`,
        refs: {
          reportIds: [r.id],
          businessIds: [r.reporter_business_id],
          ...(r.target_type === 'conversation' ? { threadId: r.target_id } : {}),
        },
      })),
    );
  });
};

/**
 * The evaluators the job runs, by kind, called through this object so a test can make one fail (`vi.spyOn`).
 */
export const FRAUD_EVALUATORS: Record<FraudSignalKind, FraudEvaluator> = {
  shared_device: evaluateSharedDevice,
  repeated_phone: evaluateRepeatedPhone,
  payment_details: evaluatePaymentDetails,
  new_account_burst: evaluateNewAccountBurst,
  reports_against: evaluateReportsAgainst,
};
