import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BUSINESS_ACTIVITIES, BUSINESS_REPORT_DETAILS_MAX, BUSINESS_REPORT_REASONS, EMPLOYEE_RANGES } from '@mpm/shared-types';
import { getMyBusiness, setMyLocation, updateMyProfile } from '../services/business/profile.service.js';
import { listSellerListings, SELLER_LISTINGS_MAX } from '../services/listings/listing-read.service.js';
import { isStorableText } from '../lib/spec-check.js';
import { reportBusiness } from '../services/reports/business-report.service.js';

const profileBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    businessName: z.string().trim().min(2).max(120).optional(),
    activities: z.array(z.enum(BUSINESS_ACTIVITIES)).min(1).optional(),
    categories: z.array(z.string().uuid()).min(1).max(50).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    // The 1900..this-year range is checked in the service.
    yearEstablished: z.number().int().nullable().optional(),
    employees: z.enum(EMPLOYEE_RANGES).nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');

const locationBody = z
  .object({
    pincode: z.string().regex(/^[1-9]\d{5}$/, 'must be a 6-digit pincode'),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    industrialAreaId: z.string().uuid().nullable().optional(),
    industrialAreaOther: z.string().trim().min(2).max(80).nullable().optional(),
    addressLine: z.string().trim().max(200).nullable().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine((b) => !!b.industrialAreaId !== !!b.industrialAreaOther, {
    message: 'Send exactly one of industrialAreaId and industrialAreaOther',
    path: ['industrialAreaId'],
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), { message: 'Send lat and lng together', path: ['lat'] });

const tags = ['Businesses'];

// `other` without details is refused by the service (`400 VALIDATION_ERROR`, field `details`).
const reportBody = z
  .object({
    reason: z.enum(BUSINESS_REPORT_REASONS),
    details: z
      .string()
      .trim()
      .max(BUSINESS_REPORT_DETAILS_MAX)
      .refine(isStorableText, 'contains characters that cannot be saved')
      .nullable()
      .optional(),
  })
  .strict();

const sellerListingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(SELLER_LISTINGS_MAX).default(20),
  exclude: z.string().uuid().optional(),
});

// The signed-in user's own business (F1 spec §10). Thin: validate → service → `{ data }`.
const businessRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/businesses/me', { schema: { tags }, preHandler: fastify.requireUser }, async (request) => ({
    data: await getMyBusiness(fastify.db, request.user!.userId),
  }));

  fastify.patch('/businesses/me', { schema: { tags }, preHandler: fastify.requireUser }, async (request) => {
    const patch = profileBody.parse(request.body);
    return { data: await updateMyProfile(fastify.db, request.user!.userId, patch) };
  });

  fastify.put('/businesses/me/location', { schema: { tags }, preHandler: fastify.requireUser }, async (request) => {
    const body = locationBody.parse(request.body);
    return { data: await setMyLocation(fastify.db, request.user!.userId, body) };
  });

  // A seller's public listings, newest first (F2 spec §8.1 "More from this seller", the seller listings screen).
  fastify.get('/businesses/:id/listings', { schema: { tags }, preHandler: fastify.optionalUser }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { limit, exclude } = sellerListingsQuery.parse(request.query);
    return { data: await listSellerListings(fastify.db, id, { limit, exclude, viewer: request.user }) };
  });

  // Report a business (admin close-out §7.1, R6, plan D8; lane A4): `BusinessReportRequest` → `{ reportId }`.
  // A viewer member may report; the reported side is never told.
  fastify.post('/businesses/:id/reports', { schema: { tags }, preHandler: fastify.requireUser }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = reportBody.parse(request.body ?? {});
    return { data: await fastify.db.transaction((tx) => reportBusiness(tx, request.user!, id, body)) };
  });
};

export default businessRoutes;
