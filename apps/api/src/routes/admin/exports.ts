import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EXPORT_SHEETS, EXPORT_SHEET_ROLES, type ExportSheet } from '@mpm/shared-types';
import type { Db } from '../../db/index.js';
import { ForbiddenError } from '../../lib/errors.js';
import { adminRateLimit } from '../../lib/group-limit.js';
import { businessesExport } from '../../services/exports/businesses.js';
import { dealsExport } from '../../services/exports/deals.js';
import { listingsExport } from '../../services/exports/listings.js';
import { partRequestsExport } from '../../services/exports/part-requests.js';
import { rentalBookingsExport } from '../../services/exports/rental-bookings.js';
import { runCsvExport } from '../../services/exports/run-export.js';
import type { SheetExport } from '../../services/exports/sheet-kit.js';
import {
  businessListFilters,
  dealListFilters,
  listingListFilters,
  partRequestListFilters,
  rentalListFilters,
} from './list-filters.js';

// AD6 exports (admin close-out §10, R12; lane A4): `GET /admin/exports/:sheet?<the list's filters>&includeContacts=1`
// → a streamed CSV through `runCsvExport` (`services/exports/run-export.ts`). You can export what you can list: the
// sheet's roles are `EXPORT_SHEET_ROLES` (super_admin passes every check), and each sheet parses its list route's own
// filter schema (`list-filters.ts`) and runs its list service's `WHERE` builder. 10 exports per 10 min per admin,
// shared with the audit log export. `includeContacts=1` adds the owner phone and email to the businesses sheet for a
// super admin only; anyone else's flag is ignored and recorded false.

const tags = ['Admin exports'];
const params = z.object({ sheet: z.enum(EXPORT_SHEETS) });
const contactsFlag = z.enum(['1', '0', 'true', 'false']).optional();

/** A sheet's list filters as parsed, with the contacts decision (businesses only). */
type ParsedSheetQuery =
  | { sheet: 'businesses'; filters: z.infer<typeof businessListFilters>; includeContacts: boolean }
  | { sheet: 'listings'; filters: z.infer<typeof listingListFilters> }
  | { sheet: 'deals'; filters: z.infer<typeof dealListFilters> }
  | { sheet: 'rental_bookings'; filters: z.infer<typeof rentalListFilters> }
  | { sheet: 'part_requests'; filters: z.infer<typeof partRequestListFilters> };

/** What `sheetGuard` parsed, for the handler. */
const parsedQueries = new WeakMap<FastifyRequest, ParsedSheetQuery>();

/** The sheet's list filters (`includeContacts` taken out) and the contacts rule; throws a `ZodError` (400) on a bad query. */
function parseSheetQuery(sheet: ExportSheet, raw: Record<string, unknown>, role: string): ParsedSheetQuery {
  const { includeContacts: flag, ...query } = raw;
  const asked = contactsFlag.parse(flag);
  switch (sheet) {
    case 'businesses':
      return {
        sheet,
        filters: businessListFilters.parse(query),
        includeContacts: role === 'super_admin' && (asked === '1' || asked === 'true'),
      };
    case 'listings':
      return { sheet, filters: listingListFilters.parse(query) };
    case 'deals':
      return { sheet, filters: dealListFilters.parse(query) };
    case 'rental_bookings':
      return { sheet, filters: rentalListFilters.parse(query) };
    case 'part_requests':
      return { sheet, filters: partRequestListFilters.parse(query) };
  }
}

/**
 * Before the rate limit, so an unknown sheet or a bad query (400) or a role outside the sheet's list (403) spends no
 * export. Keeps the parsed query for the handler.
 */
async function sheetGuard(request: FastifyRequest): Promise<void> {
  const { sheet } = params.parse(request.params);
  const role = request.admin!.role;
  if (role !== 'super_admin' && !EXPORT_SHEET_ROLES[sheet].includes(role)) throw new ForbiddenError();
  parsedQueries.set(request, parseSheetQuery(sheet, (request.query ?? {}) as Record<string, unknown>, role));
}

/** The sheet's export for the parsed query. */
function sheetExport(db: Db, parsed: ParsedSheetQuery): SheetExport {
  switch (parsed.sheet) {
    case 'businesses':
      return businessesExport(db, parsed.filters, { includeContacts: parsed.includeContacts });
    case 'listings':
      return listingsExport(db, parsed.filters);
    case 'deals':
      return dealsExport(db, parsed.filters);
    case 'rental_bookings':
      return rentalBookingsExport(db, parsed.filters);
    case 'part_requests':
      return partRequestsExport(db, parsed.filters);
  }
}

const adminExportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/admin/exports/:sheet',
    { schema: { tags }, preHandler: [fastify.requireAdmin, sheetGuard, adminRateLimit('admin_export', 10, 600)] },
    async (request, reply) => {
      const parsed = parsedQueries.get(request)!;
      const spec = sheetExport(fastify.db, parsed);
      await runCsvExport(fastify, reply, { ...spec, adminId: request.admin!.adminId, sheet: parsed.sheet });
      return reply;
    },
  );
};

export default adminExportRoutes;
