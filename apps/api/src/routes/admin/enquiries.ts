import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ENQUIRY_STATUSES, LISTING_KINDS, OFFER_STATUSES } from '@mpm/shared-types';
import { ADMIN_ENQUIRY_PAGE_SIZES, adminEnquiryDetail, listAdminEnquiries } from '../../services/offers/admin-enquiries.service.js';

// Admin Enquiries & offers (F6 + F7 spec §16.1–§16.2): read-only, no message or note text. Roles: support, operations
// (super_admin passes). Thin: Zod-parse → service → `{ data }`.

const tags = ['Admin enquiries'];

const listQuery = z.object({
  enquiryStatus: z.enum(ENQUIRY_STATUSES).optional(),
  offerStatus: z.enum(OFFER_STATUSES).optional(),
  kind: z.enum(LISTING_KINDS).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce
    .number()
    .refine((n) => (ADMIN_ENQUIRY_PAGE_SIZES as readonly number[]).includes(n), 'must be 25, 50 or 100')
    .default(25),
});
const threadParams = z.object({ threadId: z.string().uuid() });

const adminEnquiryRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: fastify.requireAdminRole('support', 'operations') };

  fastify.get('/admin/enquiries', read, async (request) => ({
    data: await listAdminEnquiries(fastify.db, listQuery.parse(request.query ?? {})),
  }));

  fastify.get('/admin/enquiries/:threadId', read, async (request) => {
    const { threadId } = threadParams.parse(request.params);
    return { data: await adminEnquiryDetail(fastify.db, threadId) };
  });
};

export default adminEnquiryRoutes;
