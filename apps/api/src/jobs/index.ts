import type { FastifyInstance } from 'fastify';
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
        const { expired } = await runListingExpiry(app.db);
        if (expired > 0) app.log.info({ job: 'listing-expiry', expired }, 'listings expired');
      },
    },
  ];
}
