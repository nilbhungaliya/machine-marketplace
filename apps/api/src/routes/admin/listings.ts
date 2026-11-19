import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ADMIN_LISTING_BULK_ACTIONS,
  ADMIN_LISTING_BULK_MAX,
  ADMIN_LISTING_PAGE_SIZES,
  ADMIN_REASON_MAX,
  LISTING_FITMENTS_MAX,
  LISTING_FLAGS,
  LISTING_KINDS,
  LISTING_STATUSES,
  PART_SIDES,
  REPORT_RESOLUTIONS,
  type AdminListingAction,
  type AdminListingPatch,
  type AdminListingPageSize,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { messageBody, reasonBody } from '../../lib/admin-text.js';
import { isStorableText } from '../../lib/spec-check.js';
import { runTx } from '../../lib/tx-effects.js';
import {
  adminListingAction,
  adminListingDetail,
  adminPatchListing,
  bulkListingAction,
  listAdminListings,
  resolveListingReports,
} from '../../services/listings/listing-admin.service.js';

const tags = ['Admin Listings'];

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const version = z.number().int().min(1);

/** A comma-separated list of enum values (`?status=live,paused`). */
const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(500)
    .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s !== ''))
    .pipe(z.array(z.enum(values)).min(1));

const listQuery = z
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
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce
      .number()
      .refine((n): n is AdminListingPageSize => (ADMIN_LISTING_PAGE_SIZES as readonly number[]).includes(n), 'must be 25, 50 or 100')
      .default(25),
  })
  .strict();

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(isStorableText, 'contains characters that cannot be saved')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const fitment = z
  .object({
    brandId: uuid,
    modelId: uuid.nullable().optional(),
    modelOther: optText(60),
    yearFrom: z.number().int().nullable().optional(),
    yearTo: z.number().int().nullable().optional(),
    note: optText(80),
  })
  .strict();

const patchBody = z
  .object({
    version,
    categoryId: uuid.optional(),
    side: z.enum(PART_SIDES).optional(),
    fitments: z.array(fitment).max(LISTING_FITMENTS_MAX).optional(),
  })
  .strict()
  .refine((p) => p.categoryId !== undefined || p.side !== undefined || p.fitments !== undefined, 'Send a category, a side or fitments');

const versionBody = z.object({ version }).strict();
const askBody = messageBody.extend({ version }).strict();
const rejectBody = reasonBody.extend({ version }).strict();
const resolveBody = z.object({ outcome: z.enum(REPORT_RESOLUTIONS), note: optText(ADMIN_REASON_MAX) }).strict();
const bulkBody = z
  .object({
    action: z.enum(ADMIN_LISTING_BULK_ACTIONS),
    ids: z.array(uuid).min(1).max(ADMIN_LISTING_BULK_MAX),
    reason: z.string().max(2000),
  })
  .strict();

/** What each status action takes from its body: the version (approve, ask for changes, reject) and the reason / message. */
const ACTIONS: Array<{ path: string; action: AdminListingAction; parse: (body: unknown) => { version?: number; reason?: string } }> = [
  { path: 'approve', action: 'approve', parse: (b) => versionBody.parse(b ?? {}) },
  {
    path: 'ask-for-changes',
    action: 'ask_for_changes',
    parse: (b) => {
      const { version: v, message } = askBody.parse(b ?? {});
      return { version: v, reason: message };
    },
  },
  { path: 'reject', action: 'reject', parse: (b) => rejectBody.parse(b ?? {}) },
  { path: 'hide', action: 'hide', parse: (b) => reasonBody.parse(b ?? {}) },
  { path: 'unhide', action: 'unhide', parse: () => ({}) },
  { path: 'remove', action: 'remove', parse: (b) => reasonBody.parse(b ?? {}) },
];

// All listings and the moderator's actions (F2 spec §11.2–§11.4, §11.6). Thin: Zod-parse → service (one transaction)
// → `{ data }`. Reads: moderators and support; every write: moderators (super_admin passes every role check). Every
// single-listing write answers the refreshed review screen (`AdminListingDetail`).
const adminListingRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };
  const moderator = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator') };

  /** Runs a write and answers the refreshed detail from the same transaction (`runTx`: queued emits go out after commit). */
  const writeThenDetail = (id: string, write: (tx: Tx) => Promise<unknown>) =>
    runTx(fastify, async (tx) => {
      await write(tx);
      return adminListingDetail(tx, id);
    });

  // `AdminListingList`.
  fastify.get('/admin/listings', read, async (request, reply) => {
    const query = listQuery.parse(request.query);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await listAdminListings(fastify.db, { ...query, pageSize: query.pageSize as AdminListingPageSize }) };
  });

  // `AdminListingDetail` (private fields included).
  fastify.get('/admin/listings/:id', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await adminListingDetail(fastify.db, id) };
  });

  // Edit category / side / fitments (`AdminListingPatch`, version checked).
  fastify.patch('/admin/listings/:id', moderator, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = patchBody.parse(request.body);
    const patch: AdminListingPatch = {
      version: body.version,
      categoryId: body.categoryId,
      side: body.side,
      fitments: body.fitments?.map((f) => ({
        brandId: f.brandId,
        modelId: f.modelId ?? null,
        modelOther: f.modelOther ?? null,
        yearFrom: f.yearFrom ?? null,
        yearTo: f.yearTo ?? null,
        note: f.note ?? null,
      })),
    };
    return { data: await writeThenDetail(id, (tx) => adminPatchListing(tx, request.admin!.adminId, id, patch)) };
  });

  // Approve, ask for changes, reject (version checked); hide, unhide, remove (always apply, R53).
  for (const { path, action, parse } of ACTIONS) {
    fastify.post(`/admin/listings/:id/${path}`, moderator, async (request) => {
      const { id } = idParams.parse(request.params);
      const opts = parse(request.body);
      return { data: await writeThenDetail(id, (tx) => adminListingAction(tx, request.admin!.adminId, id, action, opts)) };
    });
  }

  // Close every open report of the listing (`AdminResolveReportsRequest`).
  fastify.post('/admin/listings/:id/reports/resolve', moderator, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = resolveBody.parse(request.body);
    return {
      data: await writeThenDetail(id, (tx) =>
        resolveListingReports(tx, request.admin!.adminId, id, { outcome: body.outcome, note: body.note ?? null }),
      ),
    };
  });

  // Bulk hide / remove (`AdminListingBulkRequest` → `AdminListingBulkResult`), one transaction per listing.
  fastify.post('/admin/listings/bulk', moderator, async (request) => {
    const body = bulkBody.parse(request.body);
    return { data: await bulkListingAction(fastify, request.admin!.adminId, body) };
  });
};

export default adminListingRoutes;
