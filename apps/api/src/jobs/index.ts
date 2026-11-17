import type { FastifyInstance } from 'fastify';
import type { JobSpec } from './runner.js';

/**
 * Every background job the API runs. Add a feature's jobs here (e.g. part-request matching for scope F8, listing expiry,
 * notification fan-out for F9). Each job's queries use `FOR UPDATE SKIP LOCKED`, so several API processes can run it.
 */
export function allJobs(_app: FastifyInstance): JobSpec[] {
  return [];
}
