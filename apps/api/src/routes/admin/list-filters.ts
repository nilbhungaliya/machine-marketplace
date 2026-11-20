import { z, type ZodRawShape, type ZodObject, type ZodTypeAny } from 'zod';
import {
  ACCOUNT_STATUSES,
  DEAL_STATUSES,
  LISTING_FLAGS,
  LISTING_KINDS,
  LISTING_STATUSES,
  PART_REQUEST_KINDS,
  PART_REQUEST_STATUSES,
  PART_SIDES,
  RENTAL_BOOKING_STATUSES,
  VERIFICATION_STATUSES,
} from '@mpm/shared-types';
import { isRealDate } from '../../lib/spec-check.js';

// The filters of the five admin lists that export (admin close-out §10, R12, plan A4-3), minus `page` / `pageSize`: the
// list route adds its paging with `paged()` and `GET /admin/exports/:sheet` parses the same schema, so an export is
// exactly the filtered list. Each schema keeps its list's original mode (strict or not) and transforms.

const uuid = z.string().uuid();
const isoDate = z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)');

/** A comma-separated list of enum values (`?status=live,paused`). */
const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(500)
    .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s !== ''))
    .pipe(z.array(z.enum(values)).min(1));

/** Users & businesses (`GET /admin/businesses`). */
export const businessListFilters = z
  .object({
    search: z.string().max(100).optional(),
    city: z.string().max(80).optional(),
    industrialAreaId: uuid.optional(),
    verification: z.enum(VERIFICATION_STATUSES).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
  })
  .strict();

/** All listings (`GET /admin/listings`). */
export const listingListFilters = z
  .object({
    status: commaList(LISTING_STATUSES).optional(),
    kind: z.enum(LISTING_KINDS).optional(),
    machineCategoryId: uuid.optional(),
    city: z.string().max(80).optional(),
    side: z.enum(PART_SIDES).optional(),
    flags: commaList(LISTING_FLAGS).optional(),
    reported: z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true').optional(),
    businessId: uuid.optional(),
    q: z.string().max(100).optional(),
  })
  .strict();

/** Deals (`GET /admin/deals`). */
export const dealListFilters = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** Rental bookings (`GET /admin/rental-bookings`). */
export const rentalListFilters = z
  .object({
    status: z.enum(RENTAL_BOOKING_STATUSES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    businessId: uuid.optional(),
    listingId: uuid.optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

/** Part requests (`GET /admin/part-requests`). */
export const partRequestListFilters = z.object({
  status: z.enum(PART_REQUEST_STATUSES).optional(),
  kind: z.enum(PART_REQUEST_KINDS).optional(),
  machineCategoryId: uuid.optional(),
  reported: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  businessId: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
});

export type BusinessListFilters = z.infer<typeof businessListFilters>;
export type ListingListFilters = z.infer<typeof listingListFilters>;
export type DealListFilters = z.infer<typeof dealListFilters>;
export type RentalListFilters = z.infer<typeof rentalListFilters>;
export type PartRequestListFilters = z.infer<typeof partRequestListFilters>;

/** The list route's schema: its filters plus its own `page` / `pageSize` (each list keeps its paging rules). */
export function paged<S extends ZodRawShape, P extends ZodTypeAny, Q extends ZodTypeAny>(
  filters: ZodObject<S, 'strict' | 'strip'>,
  page: P,
  pageSize: Q,
) {
  return filters.extend({ page, pageSize });
}
