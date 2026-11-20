import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import type { CsvCell } from '../../lib/csv.js';
import { adminPartRequestWhere, type AdminPartRequestFilters } from '../part-requests/admin.service.js';
import { CATEGORY_PATH_SQL } from '../part-requests/admin-view.js';
import { maskedRequestName } from '../part-requests/reply-views.js';
import { istMinute } from './format.js';
import { before, enumLabel, keysetTime, n, nextOf, type SheetExport, upTo } from './sheet-kit.js';

/**
 * The part requests sheet (admin close-out §10, R12): exactly the Part requests list for the same filters
 * (`adminPartRequestWhere`). The name through `maskContact`; never the note, the budget, photos or the buyer's pincode.
 * Replies and matches counted as the list counts them (delivered replies, every match).
 */
export function partRequestsExport(conn: Db | Tx, filters: Omit<AdminPartRequestFilters, 'page' | 'pageSize'>): SheetExport {
  const fromWhere = adminPartRequestWhere(filters);
  const header = [
    'Ref', 'Status', 'Kind', 'Name', 'Category path', 'Side', 'Quantity', 'Unit', 'City', 'Reach', 'Audience', 'Posted',
    'Expires', 'Replies', 'Matches', 'Fulfilled',
  ];

  return {
    header,
    filters,
    async count(asOf) {
      const { rows } = await conn.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n ${fromWhere} AND ${upTo(sql`pr.created_at`, asOf)}`,
      );
      return Number(rows[0]?.n ?? 0);
    },
    async page(after, { asOf, pageSize }) {
      const { rows } = await conn.execute<{
        id: string;
        sort_at: string;
        ref: string | number;
        status: string;
        kind: string;
        name: string;
        category_path: string | null;
        side: string | null;
        quantity: string | null;
        unit: string | null;
        city: string | null;
        reach: string;
        audience: string;
        posted_at: string;
        expires_at: string;
        reply_count: number;
        match_count: number;
        fulfilled_at: string | null;
      }>(sql`
        SELECT pr.id, ${keysetTime(sql`pr.created_at`)} AS sort_at, pr.ref, pr.status, pr.kind, pr.name,
               ${CATEGORY_PATH_SQL} AS category_path, pr.side, trim_scale(pr.quantity)::text AS quantity,
               (SELECT u.label FROM units u WHERE u.id = pr.unit_id) AS unit, pr.city, pr.reach, pr.audience,
               ${keysetTime(sql`coalesce(pr.first_posted_at, pr.created_at)`)} AS posted_at,
               ${keysetTime(sql`pr.expires_at`)} AS expires_at,
               (SELECT count(*)::int FROM part_request_replies rr WHERE rr.part_request_id = pr.id AND rr.status = 'delivered') AS reply_count,
               (SELECT count(*)::int FROM part_request_matches m WHERE m.part_request_id = pr.id) AS match_count,
               ${keysetTime(sql`pr.fulfilled_at`)} AS fulfilled_at
        ${fromWhere} AND ${before(sql`pr.created_at`, sql`pr.id`, after, asOf)}
        ORDER BY pr.created_at DESC, pr.id DESC
        LIMIT ${pageSize}`);
      return {
        rows: rows.map((r): CsvCell[] => [
          `#${r.ref}`, enumLabel(r.status), enumLabel(r.kind), maskedRequestName(r.name), r.category_path, enumLabel(r.side),
          r.quantity, r.unit, r.city, enumLabel(r.reach), enumLabel(r.audience), istMinute(r.posted_at),
          istMinute(r.expires_at), n(r.reply_count), n(r.match_count), r.fulfilled_at ? istMinute(r.fulfilled_at) : '',
        ]),
        next: nextOf(rows, pageSize),
      };
    },
  };
}
