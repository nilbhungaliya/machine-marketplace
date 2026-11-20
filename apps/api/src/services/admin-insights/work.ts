import type { AdminRole, AdminWorkCounts } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { openDisputeCount } from '../deals/deal-admin.service.js';
import { moderationCounts } from '../listings/listing-admin.service.js';
import { countReviews } from '../verification/gst-review.service.js';
import { countOpenReports, countOpenSignals } from './counts.js';

// "Today's work" (admin close-out §6.1 section 2, R1, R4; plan A1-2): live counts, never cached, only the queues the
// role can open (the admin nav's rules, `apps/admin/lib/nav.ts`). Each count is the one its queue's badge reads.

type Conn = Db | Tx;

const can = (role: AdminRole, roles: AdminRole[]): boolean => role === 'super_admin' || roles.includes(role);

/**
 * `GET /admin/dashboard/work`: listings to review and reported (moderator, the moderation badge), verification waiting
 * (verification_officer, the review queue's `waiting`), open disputes (support), open reports and signals (moderator,
 * support; plan D5); super_admin all six. A key the role can't open is absent; a role with none gets `{}`.
 */
export async function workCounts(conn: Conn, role: AdminRole): Promise<AdminWorkCounts> {
  const out: AdminWorkCounts = {};
  const jobs: Promise<void>[] = [];
  if (can(role, ['moderator'])) {
    jobs.push(
      moderationCounts(conn).then((c) => {
        out.listingsToReview = c.review;
        out.listingsReported = c.reported;
      }),
    );
  }
  if (can(role, ['verification_officer'])) {
    jobs.push(countReviews(conn, 'waiting').then((n) => void (out.verificationWaiting = n)));
  }
  if (can(role, ['support'])) {
    jobs.push(openDisputeCount(conn).then((c) => void (out.disputesOpen = c.open)));
  }
  if (can(role, ['moderator', 'support'])) {
    jobs.push(countOpenReports(conn).then((n) => void (out.reportsOpen = n)));
    jobs.push(countOpenSignals(conn).then((n) => void (out.signalsOpen = n)));
  }
  await Promise.all(jobs);
  return out;
}
