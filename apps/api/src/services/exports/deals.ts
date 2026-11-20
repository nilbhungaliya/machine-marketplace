import { and, count, desc, eq, sql } from 'drizzle-orm';
import { milliToQuantity, quantityToMilli } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { deals, listings } from '../../db/schema.js';
import type { CsvCell } from '../../lib/csv.js';
import { adminDealWhere, buyerBiz, sellerBiz, type AdminDealQuery } from '../deals/deal-admin.service.js';
import { istMinute, rupees } from './format.js';
import { before, enumLabel, keysetTime, nextOf, type SheetExport, upTo } from './sheet-kit.js';

/**
 * The deals sheet (admin close-out §10, R12): exactly the Deals list for the same filters (`adminDealWhere`, its joins).
 * Never notes, the handover note or photos; the cancel reason as its code.
 */
export function dealsExport(conn: Db | Tx, filters: Omit<AdminDealQuery, 'page' | 'pageSize'>): SheetExport {
  const where = adminDealWhere(filters);
  const header = [
    'Ref', 'Status', 'Listing ref', 'Listing title', 'Buyer', 'Seller', 'Quantity', 'Unit', 'Price per unit (INR)',
    'Total (INR)', 'Agreed', 'Handed over', 'Completed', 'Cancelled', 'Cancel reason',
  ];
  const time = (d: Date | null): string => (d ? istMinute(d) : '');

  return {
    header,
    filters,
    async count(asOf) {
      const [row] = await conn
        .select({ n: count() })
        .from(deals)
        .innerJoin(listings, eq(listings.id, deals.listingId))
        .innerJoin(buyerBiz, eq(buyerBiz.id, deals.buyerBusinessId))
        .innerJoin(sellerBiz, eq(sellerBiz.id, deals.sellerBusinessId))
        .where(and(where, upTo(sql`${deals.createdAt}`, asOf)));
      return Number(row?.n ?? 0);
    },
    async page(after, { asOf, pageSize }) {
      const rows = await conn
        .select({
          id: deals.id,
          sort_at: keysetTime(sql`${deals.createdAt}`).mapWith(String),
          deal: deals,
          listingRef: listings.ref,
          buyerName: buyerBiz.tradeName,
          sellerName: sellerBiz.tradeName,
        })
        .from(deals)
        .innerJoin(listings, eq(listings.id, deals.listingId))
        .innerJoin(buyerBiz, eq(buyerBiz.id, deals.buyerBusinessId))
        .innerJoin(sellerBiz, eq(sellerBiz.id, deals.sellerBusinessId))
        .where(and(where, before(sql`${deals.createdAt}`, sql`${deals.id}`, after, asOf)))
        .orderBy(desc(deals.createdAt), desc(deals.id))
        .limit(pageSize);
      return {
        rows: rows.map(({ deal: d, listingRef, buyerName, sellerName }): CsvCell[] => [
          `#${d.ref}`, enumLabel(d.status), `#${listingRef}`, d.listingTitle, buyerName, sellerName,
          milliToQuantity(quantityToMilli(d.quantity)), d.unitLabel, rupees(d.pricePerUnitPaise), rupees(d.totalPaise),
          time(d.acceptedAt), time(d.handedOverAt), time(d.completedAt), time(d.cancelledAt), d.cancelReason,
        ]),
        next: nextOf(rows, pageSize),
      };
    },
  };
}
