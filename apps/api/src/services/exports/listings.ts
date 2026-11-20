import { sql } from 'drizzle-orm';
import type { AdminListingFilters } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { CsvCell } from '../../lib/csv.js';
import { adminListingWhere } from '../listings/listing-admin.service.js';
import { istMinute, rupees } from './format.js';
import { before, enumLabel, keysetTime, n, nextOf, type SheetExport, upTo } from './sheet-kit.js';

/**
 * The listings sheet (admin close-out §10, R12): exactly All listings for the same filters (`adminListingWhere`). No
 * description, condition note, address or photos.
 */
export function listingsExport(conn: Db | Tx, filters: AdminListingFilters): SheetExport {
  const fromWhere = adminListingWhere(filters);
  const header = [
    'Ref', 'Kind', 'Status', 'Title', 'Category path', 'Brand', 'Part number', 'Side', 'Condition', 'Quantity',
    'Available', 'Unit', 'Price model', 'Price (INR)', 'City', 'Industrial area', 'Seller', 'Open reports', 'Created',
    'First live', 'Refreshed',
  ];

  return {
    header,
    filters: { ...filters },
    async count(asOf) {
      const { rows } = await conn.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n ${fromWhere} AND ${upTo(sql`l.created_at`, asOf)}`,
      );
      return Number(rows[0]?.n ?? 0);
    },
    async page(after, { asOf, pageSize }) {
      const { rows } = await conn.execute<{
        id: string;
        sort_at: string;
        ref: string | number;
        kind: string;
        status: string;
        title: string | null;
        category_path: string | null;
        brand: string | null;
        part_number: string | null;
        side: string | null;
        condition: string | null;
        quantity: string | null;
        available: string | null;
        unit: string | null;
        price_model: string | null;
        price_paise: string | number | null;
        city: string | null;
        area: string | null;
        seller: string;
        open_reports: number;
        first_live_at: string | null;
        refreshed_at: string | null;
      }>(sql`
        SELECT l.id, ${keysetTime(sql`l.created_at`)} AS sort_at, l.ref, l.kind, l.status, l.title,
               concat_ws(' › ', g.name, p.name, c.name) AS category_path,
               coalesce(
                 (SELECT pb.name FROM brands pb WHERE pb.id = l.part_brand_id),
                 (SELECT coalesce(mb.name, lm.brand_other) FROM listing_machines lm
                    LEFT JOIN brands mb ON mb.id = lm.brand_id WHERE lm.listing_id = l.id)
               ) AS brand,
               l.part_number, l.side,
               (SELECT cd.label FROM conditions cd WHERE cd.id = l.condition_id) AS condition,
               trim_scale(l.quantity)::text AS quantity,
               trim_scale(l.quantity - l.held_quantity)::text AS available,
               (SELECT u.label FROM units u WHERE u.id = l.unit_id) AS unit,
               l.price_model, l.price_paise, l.city,
               coalesce((SELECT ia.name FROM industrial_areas ia WHERE ia.id = l.industrial_area_id), l.industrial_area_other) AS area,
               b.trade_name AS seller,
               (SELECT count(*)::int FROM reports r WHERE r.target_type = 'listing' AND r.target_id = l.id
                  AND r.status IN ('open', 'reviewing')) AS open_reports,
               ${keysetTime(sql`l.first_live_at`)} AS first_live_at,
               ${keysetTime(sql`l.refreshed_at`)} AS refreshed_at
        ${fromWhere} AND ${before(sql`l.created_at`, sql`l.id`, after, asOf)}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${pageSize}`);
      return {
        rows: rows.map((r): CsvCell[] => [
          `#${r.ref}`, enumLabel(r.kind), enumLabel(r.status), r.title, r.category_path || null, r.brand, r.part_number,
          enumLabel(r.side), r.condition, r.quantity, r.available, r.unit, enumLabel(r.price_model),
          r.price_paise === null ? '' : rupees(BigInt(r.price_paise)), r.city, r.area, r.seller, n(r.open_reports),
          istMinute(r.sort_at), r.first_live_at ? istMinute(r.first_live_at) : '', r.refreshed_at ? istMinute(r.refreshed_at) : '',
        ]),
        next: nextOf(rows, pageSize),
      };
    },
  };
}
