import { and, eq, sql } from 'drizzle-orm';
import {
  meetsRentalMinimum,
  rentalEndDate,
  rentalEstimate,
  resolveRentalChoices,
  type RentalEstimateRequest,
  type RentalEstimateResult,
  type RentalTermsSnapshot,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listingRentals, listings } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { listingNotFound } from '../listings/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { centroidSql } from '../listings/listing-validate.service.js';
import { machinesOf, maxOutInRange } from './capacity.js';

type Conn = Db | Tx;

/**
 * The estimate (M14 spec R2, §6.2, §13.2; plan C0-3a): the shared `rentalEstimate` with the listing's current terms.
 * Input validation (counts, dates, machines, pincode known) is the route's (A1); this only refuses a period the
 * listing doesn't price. **Never returns a distance** (probing pincodes would locate the machine): only
 * `beyondServiceRadius`.
 */

/** The listing's rates and terms as a booking stores them (`terms_snapshot`); `404 LISTING_NOT_FOUND` without them. */
export async function termsSnapshotOf(conn: Conn, listingId: string): Promise<RentalTermsSnapshot> {
  const [r] = await conn.select().from(listingRentals).where(eq(listingRentals.listingId, listingId));
  if (!r) throw listingNotFound();
  return {
    rateHourPaise: r.rateHourPaise,
    rateDayPaise: r.rateDayPaise,
    rateWeekPaise: r.rateWeekPaise,
    rateMonthPaise: r.rateMonthPaise,
    shiftHours: r.shiftHours,
    monthDays: r.monthDays,
    operator: r.operator,
    operatorRateDayPaise: r.operatorRateDayPaise,
    fuel: r.fuel,
    transport: r.transport,
    transportChargePaise: r.transportChargePaise,
    depositPaise: r.depositPaise,
    minDuration: r.minDuration,
    minDurationPeriod: r.minDurationPeriod,
    serviceRadiusKm: r.serviceRadiusKm,
  };
}

export function periodNotOffered(): ValidationError {
  return new ValidationError('This machine isn’t rented by that period', undefined, 'RENTAL_PERIOD_NOT_OFFERED');
}

/**
 * Whether the site pincode's centroid lies beyond the listing's service radius, measured from the listing's point (else
 * its search point). Null without a pincode, a radius, a listing point or a known pincode. The distance never leaves
 * this function.
 */
export async function beyondServiceRadius(
  conn: Conn,
  listingId: string,
  sitePincode: string | null | undefined,
  serviceRadiusKm: number | null,
): Promise<boolean | null> {
  if (!sitePincode || serviceRadiusKm == null) return null;
  const { rows } = await conn.execute<{ beyond: boolean | null }>(sql`
    SELECT ST_Distance(COALESCE(l.point, l.search_point), ${centroidSql(sitePincode)}) > ${serviceRadiusKm * 1000} AS beyond
    FROM listings l WHERE l.id = ${listingId}::uuid
  `);
  return rows[0]?.beyond ?? null;
}

/** `POST /rentals/estimate` (and the request's version estimate): amounts, end date, free, minimum, radius warning. */
export async function estimateFor(
  conn: Conn,
  listingId: string,
  req: Omit<RentalEstimateRequest, 'listingId'> & { listingId?: string },
): Promise<RentalEstimateResult> {
  // Only a public rental listing has an estimate (C0 review M3): anything else is `404 LISTING_NOT_FOUND`.
  const [listing] = await conn
    .select({ quantity: listings.quantity })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.kind, 'machine_rental'), publicListingWhere()));
  if (!listing) throw listingNotFound();
  const terms = await termsSnapshotOf(conn, listingId);
  const choices = resolveRentalChoices(terms, req);
  const money = rentalEstimate(terms, { period: req.period, count: req.count, machines: req.machines, ...choices });
  if (!money) throw periodNotOffered();
  const endDate = rentalEndDate(req.startDate, req.period, req.count);
  const out = await maxOutInRange(conn, listingId, req.startDate, endDate);
  return {
    endDate,
    days: money.days,
    rentPaise: money.rentPaise,
    operatorPaise: money.operatorPaise,
    transportPaise: money.transportPaise,
    totalPaise: money.totalPaise,
    free: out + req.machines <= machinesOf(listing),
    minimumMet: meetsRentalMinimum(terms, req.period, req.count),
    beyondServiceRadius: await beyondServiceRadius(conn, listingId, req.sitePincode, terms.serviceRadiusKm),
    withOperator: choices.withOperator,
    ownerDelivers: choices.ownerDelivers,
  };
}
