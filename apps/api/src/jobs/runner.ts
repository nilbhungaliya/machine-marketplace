import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { Sentry } from '../lib/sentry.js';

/**
 * In-process background jobs (ORA / textile pattern): `setInterval` here, with `FOR UPDATE SKIP LOCKED` in the job's own
 * queries so several API processes can run the same job safely. No BullMQ.
 *
 * Jobs start only from `index.ts` (when `JOBS_ENABLED !== 'false'`), never from `buildApp`, so tests don't run them.
 */

export interface JobSpec {
  name: string;
  everyMs: number;
  /** Delay before the first run; defaults to `everyMs`. */
  firstRunMs?: number;
  run: () => Promise<unknown>;
}

/**
 * Starts one job and returns its stop function. A tick that arrives while the previous run is still going is
 * skipped (never two runs of the same job at once in this process). A failing run is logged, reported to Sentry
 * with tag `job`, and swallowed: the next tick runs as usual. The stop function's promise settles once a run in progress has ended.
 */
export function startJob(log: Pick<FastifyBaseLogger, 'error'>, spec: JobSpec): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const runOnce = async () => {
    try {
      await spec.run();
    } catch (err) {
      log.error({ err, job: spec.name }, `job "${spec.name}" failed`);
      Sentry.captureException(err, { tags: { job: spec.name } });
    }
  };

  const tick = () => {
    if (stopped || running) return;
    // Cleared from the stored promise: a `run` that throws before its first await settles `runOnce` before this line assigns it.
    running = runOnce().finally(() => {
      running = undefined;
    });
  };

  const first = setTimeout(() => {
    if (stopped) return;
    interval = setInterval(tick, spec.everyMs);
    tick();
  }, spec.firstRunMs ?? spec.everyMs);

  return async () => {
    stopped = true;
    clearTimeout(first);
    if (interval) clearInterval(interval);
    await running;
  };
}

/**
 * Starts every job and stops them all when the app closes. Works before or after `listen`: Fastify refuses
 * `addHook` once the app has started, so a listening app is stopped on its HTTP server's `close` instead
 * (`app.close()` closes that server). That can't wait for a running job, so a shutdown calls the returned function
 * first: it resolves once every run in progress has ended, while the database is still open.
 */
export function startJobs(app: FastifyInstance, specs: JobSpec[]): () => Promise<void> {
  const stops = specs.map((spec) => startJob(app.log, spec));
  const stopAll = async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
  if (app.server.listening) {
    app.server.once('close', () => void stopAll());
  } else {
    app.addHook('onClose', stopAll);
  }
  return stopAll;
}
