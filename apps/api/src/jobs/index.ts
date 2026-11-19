import type { FastifyInstance } from 'fastify';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';
import { runSearchRefreshTick } from '../services/discovery/refresh-jobs.js';
import { deleteOldSearchQueries } from '../services/discovery/search-log.service.js';
import { runListingExpiry } from '../services/listings/listing-jobs.service.js';
import type { JobSpec } from './runner.js';

/**
 * Every background job the API runs. Add a feature's jobs here (e.g. part-request matching for scope F8, notification
 * fan-out for F9). Each job's queries use `FOR UPDATE SKIP LOCKED`, so several API processes can run it.
 */
export function allJobs(app: FastifyInstance): JobSpec[] {
  return [
    // Listing expiry (F2 spec §7.4): every hour, first run a minute after start.
    {
      name: 'listing-expiry',
      everyMs: 3_600_000,
      firstRunMs: 60_000,
      run: async () => {
        const { expired } = await runListingExpiry(app.db, { log: app.log });
        if (expired > 0) app.log.info({ job: 'listing-expiry', expired }, 'listings expired');
      },
    },
    // Search text rebuilds after a catalogue rename / move / delete (F4 + F5 spec §5.2): every 30 s, a few jobs a tick.
    {
      name: 'search-refresh',
      everyMs: DISCOVERY_LIMITS.refreshJobIntervalMs,
      run: async () => {
        await runSearchRefreshTick(app.db, {
          onError: (r) => app.log.warn({ job: 'search-refresh', jobId: r.jobId, error: r.error }, 'search refresh failed'),
        });
      },
    },
    // Search log retention (F4 + F5 spec §5.13): daily, first run ten minutes after start.
    {
      name: 'search-query-retention',
      everyMs: 86_400_000,
      firstRunMs: 600_000,
      run: async () => {
        const deleted = await deleteOldSearchQueries(app.db);
        if (deleted > 0) app.log.info({ job: 'search-query-retention', deleted }, 'old search queries deleted');
      },
    },
  ];
}
