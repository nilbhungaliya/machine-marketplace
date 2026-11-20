import type { AdminReportCounts } from '@mpm/shared-types';
import { api } from './api';

// Typed calls to the admin Reports & flags API (admin close-out §7.2, §8.3, R7). Role: moderator, support
// (super_admin passes). Lane B3 extends this file with the queue and resolve calls.

/** `GET /admin/reports/count`: open reports (status `open` or `reviewing`, every target) and open fraud signals (D5). */
export const fetchReportCounts = () => api.get<AdminReportCounts>('/admin/reports/count');

/** The nav badge `reportsOpen`: open reports + open signals. */
export async function fetchReportsOpenCount(): Promise<number> {
  const { reports, signals } = await fetchReportCounts();
  return reports + signals;
}
