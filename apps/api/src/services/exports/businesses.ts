import { sql } from 'drizzle-orm';
import type { AccountStatus, VerificationStatus } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { CsvCell } from '../../lib/csv.js';
import { businessListWhere, type BusinessListQuery } from '../admin/business-admin.service.js';
import { istMinute } from './format.js';
import { before, enumLabel, enumLabels, keysetTime, n, nextOf, type SheetExport, upTo } from './sheet-kit.js';

/**
 * The businesses sheet (admin close-out §10, R12): exactly the Users & businesses list for the same filters
 * (`businessListWhere`). Never PAN, address or GST address. Owner phone and the business email only when the caller says
 * so (`includeContacts`: the route passes true only for a super admin who asked with `includeContacts=1`).
 */
export function businessesExport(
  conn: Db | Tx,
  filters: Omit<BusinessListQuery, 'page' | 'pageSize'>,
  opts: { includeContacts: boolean },
): SheetExport {
  const fromWhere = businessListWhere(filters);
  const contacts = opts.includeContacts;
  const header = [
    'Business id', 'Trade name', 'Legal name', 'GSTIN', 'Verification', 'City', 'State', 'Pincode', 'Industrial area',
    'Activities', 'Machine categories', 'Owner name', 'Owner status', 'Listings live', 'Listings (all)',
    'Deals as buyer', 'Deals as seller', 'Created',
    ...(contacts ? ['Owner phone', 'Email'] : []),
  ];

  return {
    header,
    filters,
    includeContacts: contacts,
    async count(asOf) {
      const { rows } = await conn.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n ${fromWhere} AND ${upTo(sql`b.created_at`, asOf)}`,
      );
      return Number(rows[0]?.n ?? 0);
    },
    async page(after, { asOf, pageSize }) {
      const { rows } = await conn.execute<{
        id: string;
        sort_at: string;
        trade_name: string;
        legal_name: string | null;
        gstin: string | null;
        verification_status: VerificationStatus;
        city: string | null;
        state: string | null;
        pincode: string | null;
        area: string | null;
        activities: string[];
        category_names: string | null;
        owner_name: string | null;
        owner_status: AccountStatus | null;
        listings_live: number;
        listings_all: number;
        deals_buyer: number;
        deals_seller: number;
        owner_phone: string | null;
        email: string | null;
      }>(sql`
        SELECT b.id, ${keysetTime(sql`b.created_at`)} AS sort_at, b.trade_name, b.legal_name, b.gstin,
               b.verification_status, b.city, b.state, b.pincode, coalesce(ia.name, b.industrial_area_other) AS area,
               b.activities,
               (SELECT string_agg(c.name, '; ' ORDER BY c.name) FROM categories c
                 WHERE c.id::text IN (SELECT jsonb_array_elements_text(b.categories))) AS category_names,
               o.name AS owner_name, o.status AS owner_status,
               (SELECT count(*)::int FROM listings x WHERE x.business_id = b.id AND x.status = 'live') AS listings_live,
               (SELECT count(*)::int FROM listings x WHERE x.business_id = b.id AND x.status <> 'draft') AS listings_all,
               (SELECT count(*)::int FROM deals d WHERE d.buyer_business_id = b.id) AS deals_buyer,
               (SELECT count(*)::int FROM deals d WHERE d.seller_business_id = b.id) AS deals_seller,
               ${contacts ? sql`o.phone` : sql`NULL::text`} AS owner_phone,
               ${contacts ? sql`b.email` : sql`NULL::text`} AS email
        ${fromWhere} AND ${before(sql`b.created_at`, sql`b.id`, after, asOf)}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT ${pageSize}`);
      return {
        rows: rows.map((r): CsvCell[] => [
          r.id, r.trade_name, r.legal_name, r.gstin, enumLabel(r.verification_status), r.city, r.state, r.pincode, r.area,
          enumLabels(r.activities), r.category_names, r.owner_name, enumLabel(r.owner_status), n(r.listings_live),
          n(r.listings_all), n(r.deals_buyer), n(r.deals_seller), istMinute(r.sort_at),
          ...(contacts ? [r.owner_phone, r.email] : []),
        ]),
        next: nextOf(rows, pageSize),
      };
    },
  };
}
