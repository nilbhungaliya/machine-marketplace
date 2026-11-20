import { count, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { fraudSignals, reports } from '../../db/schema.js';

// Open counts (admin close-out plan D5): the Reports & flags nav badge (`GET /admin/reports/count`) and the dashboard's
// "waiting on you" tiles read the same two definitions.

/** Reports waiting on staff: status `open` or `reviewing`, any target (listing reports included). */
export async function countOpenReports(conn: Db | Tx): Promise<number> {
  const [row] = await conn.select({ n: count() }).from(reports).where(inArray(reports.status, ['open', 'reviewing']));
  return row?.n ?? 0;
}

/** Fraud signals waiting on review: status `open`. */
export async function countOpenSignals(conn: Db | Tx): Promise<number> {
  const [row] = await conn.select({ n: count() }).from(fraudSignals).where(eq(fraudSignals.status, 'open'));
  return row?.n ?? 0;
}
