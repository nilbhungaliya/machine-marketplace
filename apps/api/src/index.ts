import './instrument.js'; // must stay first — see the file
import { assertApiEnv } from './env.js';
import { buildApp } from './app.js';
import { allJobs } from './jobs/index.js';
import { getPushProvider, pushOffInProduction } from './services/notifications/push-provider.js';
import { startJobs } from './jobs/runner.js';
import { setupSocketIO } from './socket/setup.js';

assertApiEnv();
const app = await buildApp();
setupSocketIO(app);
// F6 + F7 §11.5: push is opt-in (as Sentry). Production without keys starts, warns once and records pushes `skipped`.
if (pushOffInProduction()) app.log.warn('push notifications are off: FIREBASE_SERVICE_ACCOUNT_B64 is not set or not a valid service account');
// Builds the provider now, so a malformed key warns once at boot (never its value), not on the first push.
getPushProvider();
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);

// A deploy sends SIGTERM. Jobs first, while the database is open, then the server. The last timer is for a socket that
// holds the close open; compose's stop_grace_period must stay above it.
const JOB_WAIT_MS = 20_000;
const SHUTDOWN_LIMIT_MS = 28_000;
let stopJobs: () => Promise<void> = async () => {};
let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  setTimeout(() => {
    app.log.error('shutdown took too long, exiting');
    process.exit(1);
  }, SHUTDOWN_LIMIT_MS).unref();
  try {
    await Promise.race([stopJobs(), new Promise((resolve) => setTimeout(resolve, JOB_WAIT_MS).unref())]);
    await app.close();
    app.log.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown failed');
    process.exit(1);
  }
};
process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Background jobs: never from buildApp, so tests don't run them. JOBS_ENABLED=false turns them off (e.g. a second dev
// server sharing the database).
if (process.env.JOBS_ENABLED !== 'false') {
  const jobs = allJobs(app);
  stopJobs = startJobs(app, jobs);
  app.log.info({ jobs: jobs.map((j) => j.name) }, 'background jobs started');
}
