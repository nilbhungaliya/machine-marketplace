import type { TxApp } from '../../lib/tx-effects.js';

/**
 * The `fraud-signals` job (admin close-out §8.2, plan D9): on a dedicated pool client holding
 * `pg_try_advisory_lock(hashtext('fraud-signals'))` (`pg_advisory_lock` with `wait`), runs every rule over its
 * watermark and advances the watermarks only after the evaluation succeeded. `'skipped'` when another run holds the lock.
 */
export async function runFraudSignals(_app: TxApp, _opts: { wait?: boolean } = {}): Promise<'ran' | 'skipped'> {
  // AC-STUB(A3)
  return 'skipped';
}
