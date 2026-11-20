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

/** Before the rate limit, so an unknown sheet (400) or a role outside the sheet's list (403) spends no export. */
async function sheetGuard(request: FastifyRequest): Promise<void> {
  const { sheet } = params.parse(request.params);
  const role = request.admin!.role;
  if (role !== 'super_admin' && !EXPORT_SHEET_ROLES[sheet].includes(role)) throw new ForbiddenError();
}

/** The sheet's export for the query (its list's filters, `includeContacts` already taken out). */
function sheetExport(db: Db, sheet: ExportSheet, query: Record<string, unknown>, includeContacts: boolean): SheetExport {
  switch (sheet) {
    case 'businesses':
      return businessesExport(db, businessListFilters.parse(query), { includeContacts });
    case 'listings':
      return listingsExport(db, listingListFilters.parse(query));
    case 'deals':
      return dealsExport(db, dealListFilters.parse(query));
    case 'rental_bookings':
      return rentalBookingsExport(db, rentalListFilters.parse(query));
    case 'part_requests':
      return partRequestsExport(db, partRequestListFilters.parse(query));
  }
}

const adminExportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/admin/exports/:sheet',
    { schema: { tags }, preHandler: [fastify.requireAdmin, sheetGuard, adminRateLimit('admin_export', 10, 600)] },
    async (request, reply) => {
      const { sheet } = params.parse(request.params);
      const { includeContacts: flag, ...query } = (request.query ?? {}) as Record<string, unknown>;
      const asked = contactsFlag.parse(flag);
      const includeContacts =
        sheet === 'businesses' && request.admin!.role === 'super_admin' && (asked === '1' || asked === 'true');
      const spec = sheetExport(fastify.db, sheet, query, includeContacts);
      await runCsvExport(fastify, reply, { ...spec, adminId: request.admin!.adminId, sheet });
      return reply;
    },
  );
};

export default adminExportRoutes;
