import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BUSINESS_ACTIVITIES, EMPLOYEE_RANGES } from '@mpm/shared-types';
import { getMyBusiness, setMyLocation, updateMyProfile } from '../services/business/profile.service.js';
import { listSellerListings, SELLER_LISTINGS_MAX } from '../services/listings/listing-read.service.js';
import { AppError } from '../lib/errors.js';

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
  fastify.post('/businesses/:id/reports', { schema: { tags }, preHandler: fastify.requireUser }, async () => {
    // AC-STUB(A4): answers 501 until lane A4 builds it.
    throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
  });
};

export default businessRoutes;
