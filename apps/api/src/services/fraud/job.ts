import { pool } from '../../db/index.js';
import type { TxApp } from '../../lib/tx-effects.js';
import { getSettings } from '../settings.service.js';
import { signalHashKey } from './hash.js';
import { FRAUD_EVALUATORS } from './rules.js';
import { advanceScan, scanChatMessages, scanSince } from './scan.js';

/**
 * The `fraud-signals` job (admin close-out §8.2, plan D9): on a dedicated pool client holding
 * `pg_try_advisory_lock(hashtext('fraud-signals'))` (`pg_advisory_lock` with `wait`), runs every rule over its
 * watermark and advances the watermarks only after the evaluation succeeded. `'skipped'` when another run holds the lock.
 *
 * 1. Scans: chat messages (`last_seq`), install sightings, young businesses' threads and replies, reports (`last_at`),
 *    each with the 2-minute margin, none advancing.
 * 2. Evaluates each rule for the businesses its source touched (one short transaction per business and kind).
 * 3. Only when every evaluation succeeded, one transaction moves each watermark to its mark. A failure is logged (ids
 *    only) and the run ends without advancing, so the next run re-reads the same window; scanning and evaluating are
 *    idempotent (unique sightings, evidence keys).
 */
export async function runFraudSignals(app: TxApp, opts: { wait?: boolean } = {}): Promise<'ran' | 'skipped'> {
  const client = await pool.connect();
  let locked = false;
  try {
    if (opts.wait) {
      await client.query(`SELECT pg_advisory_lock(hashtext('fraud-signals'))`);
      locked = true;
    } else {
      const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('fraud-signals')) AS ok`);
      locked = rows[0]?.ok === true;
    }
    if (!locked) return 'skipped';
    await runLocked(app);
    return 'ran';
  } finally {
    let unlocked = true;
    if (locked) {
      unlocked = await client.query(`SELECT pg_advisory_unlock(hashtext('fraud-signals'))`).then(
        () => true,
        () => false,
      );
    }
    // A session lock that could not be released dies with its connection: destroy it rather than pool it.
    client.release(!unlocked);
  }
}

async function runLocked(app: TxApp): Promise<void> {
  const key = signalHashKey(app.log);
  const settings = await getSettings(app.db);

  const chat = await scanChatMessages(app, { key });
  const devices = await scanSince(app.db, 'install_sightings');
  const burst = await scanSince(app.db, 'new_account_burst');
  const reports = await scanSince(app.db, 'reports_against');

  const chatTouched = [...chat.touched];
  const steps: [keyof typeof FRAUD_EVALUATORS, string[]][] = [
    ['repeated_phone', chatTouched],
    ['payment_details', chatTouched],
    ['shared_device', devices.rows.map((r) => r.businessId)],
    ['new_account_burst', burst.rows.map((r) => r.businessId)],
    ['reports_against', reports.rows.map((r) => r.businessId)],
  ];
  for (const [kind, businessIds] of steps) {
    if (businessIds.length === 0) continue;
    try {
      await FRAUD_EVALUATORS[kind](app, businessIds, settings, key);
    } catch (err) {
      // Ids and the rule only: never a number, a message or the key.
      app.log.error({ err, kind, businesses: businessIds.length }, 'fraud-signals: evaluation failed; watermarks kept');
      return;
    }
  }

  await app.db.transaction(async (tx) => {
    if (chat.mark) await advanceScan(tx, 'chat_messages', chat.mark.lastSeq);
    if (devices.mark) await advanceScan(tx, 'install_sightings', devices.mark);
    if (burst.mark) await advanceScan(tx, 'new_account_burst', burst.mark);
    if (reports.mark) await advanceScan(tx, 'reports_against', reports.mark);
  });
}
