import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DELIVERY_OPTIONS,
  GST_PRICE_MODES,
  LISTING_DESCRIPTION_MAX,
  LISTING_FITMENTS_MAX,
  LISTING_KINDS,
  LISTING_REPORT_REASONS,
  LISTING_TITLE_MAX,
  LISTING_TITLE_MIN,
  PART_NUMBER_MAX,
  PART_SIDES,
  PRICE_MODELS,
  RENTAL_FUEL_OPTIONS,
  RENTAL_OPERATOR_OPTIONS,
  RENTAL_PERIODS,
  RENTAL_TRANSPORT_OPTIONS,
  MY_LISTINGS_GROUPS,
  SELLER_LISTING_ACTIONS,
} from '@mpm/shared-types';
import { perUser } from '../lib/per-user-limit.js';
import { isRealDate, isStorableText } from '../lib/spec-check.js';
import { runTx } from '../lib/tx-effects.js';
import { applySellerAction, publishListing } from '../services/listings/listing-lifecycle.service.js';
import { getListing, getOwnerView, listMine } from '../services/listings/listing-read.service.js';
import { createReport } from '../services/listings/listing-reports.service.js';
import { findOtherSide } from '../services/listings/other-side.service.js';
import { createListing, deleteDraftWithMedia, patchListing, type ListingPatchInput } from '../services/listings/listing-write.service.js';

// Seller listing writes (F2 spec §5.3, §7.3, §14). Thin: Zod-parse → service (in one transaction) → `{ data }`. Types,
// formats and limits are checked here; references, kind rules and grandfathering in the service.

const tags = ['Listings'];

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const storable = (s: string) => isStorableText(s);

/** Trimmed text of `min`–`max` characters that Postgres can store. */
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(storable, 'contains characters that cannot be saved');
/** Optional text: `''` and null clear it. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(storable, 'contains characters that cannot be saved')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Decimal string, > 0, ≤ 1 000 000, at most 3 decimals (§4.2). */
const quantity = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, 'must be a number with at most 3 decimals')
  .refine((v) => Number(v) > 0 && Number(v) <= 1_000_000, 'must be more than 0 and at most 1 000 000');
const paise = (min: number, max: number) => z.number().int().min(min).max(max);
const RATE_MAX = 10_000_000_000;
const pastYear = (min: number) =>
  z.number().int().min(min).refine((y) => y <= new Date().getFullYear(), "can't be in the future");

const specValue = z.union([z.string().max(1000), z.array(z.string().max(200)).max(100), z.number()]);
const specs = z.record(z.string().min(1).max(64), specValue).refine((s) => Object.keys(s).length <= 200, 'too many fields');

const godown = z
  .object({
    source: z.literal('godown'),
    pincode: z.string().regex(/^[1-9]\d{5}$/, 'must be a 6-digit pincode'),
    city: text(1, 80),
    state: text(1, 80),
    industrialAreaId: uuid.nullable().optional(),
    industrialAreaOther: optText(80),
    addressLine: optText(200),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .strict()
  .refine((g) => !(g.industrialAreaId && g.industrialAreaOther), { message: 'Send an industrial area or Other, not both', path: ['industrialAreaId'] })
  .refine((g) => (g.lat == null) === (g.lng == null), { message: 'Send lat and lng together', path: ['lat'] });
const location = z.union([z.object({ source: z.literal('business') }).strict(), godown]);

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

const machine = z
  .object({
    brandId: uuid.nullable(),
    brandOther: text(2, 60).nullable(),
    modelId: uuid.nullable(),
    modelOther: text(1, 60).nullable(),
    year: pastYear(1950).nullable(),
    hoursRun: z.number().int().min(0).max(1_000_000).nullable(),
    serialNumber: optText(60),
    underPower: z.boolean(),
    inspectionByAppointment: z.boolean(),
    reasonForSale: optText(200),
  })
  .partial()
  .strict();

const rental = z
  .object({
    rateHourPaise: paise(1, RATE_MAX).nullable(),
    rateDayPaise: paise(1, RATE_MAX).nullable(),
    rateWeekPaise: paise(1, RATE_MAX).nullable(),
    rateMonthPaise: paise(1, RATE_MAX).nullable(),
    shiftHours: z.number().int().min(1).max(24),
    monthDays: z.number().int().min(1).max(31),
    overtimeRateHourPaise: paise(1, RATE_MAX).nullable(),
    minDuration: z.number().int().min(1).max(365).nullable(),
    minDurationPeriod: z.enum(RENTAL_PERIODS).nullable(),
    operator: z.enum(RENTAL_OPERATOR_OPTIONS).nullable(),
    operatorRateDayPaise: paise(1, RATE_MAX).nullable(),
    fuel: z.enum(RENTAL_FUEL_OPTIONS),
    transport: z.enum(RENTAL_TRANSPORT_OPTIONS).nullable(),
    transportChargePaise: paise(1, RATE_MAX).nullable(),
    serviceRadiusKm: z.number().int().min(1).max(2000).nullable(),
    depositPaise: paise(1, 100_000_000_000).nullable(),
    availableFrom: z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)').nullable(),
    availabilityNote: optText(200),
  })
  .partial()
  .strict();

/** F8 §9.3: `partRequestId` makes a draft prefilled from that request, with a pending reply. */
const createBody = z.object({ kind: z.enum(LISTING_KINDS), partRequestId: z.string().uuid().optional() }).strict();

const patchBody = z
  .object({
    kind: z.enum(LISTING_KINDS),
    categoryId: uuid,
    title: text(LISTING_TITLE_MIN, LISTING_TITLE_MAX),
    description: optText(LISTING_DESCRIPTION_MAX),
    specs,
    partNumber: z
      .string()
      .trim()
      .max(PART_NUMBER_MAX)
      .regex(/^[A-Za-z0-9 ./-]*$/, 'may use letters, digits, space, dot, slash and hyphen')
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    partBrandId: uuid.nullable(),
    side: z.enum(PART_SIDES),
    quantity,
    unitId: uuid,
    minOrderQty: quantity.nullable(),
    conditionId: uuid,
    conditionNote: optText(300),
    priceModel: z.enum(PRICE_MODELS),
    pricePaise: paise(100, 100_000_000_000).nullable(),
    gstMode: z.enum(GST_PRICE_MODES).nullable(),
    delivery: z.array(z.enum(DELIVERY_OPTIONS)).max(DELIVERY_OPTIONS.length * 2),
    location,
    fitments: z.array(fitment).max(LISTING_FITMENTS_MAX),
    machine,
    rental,
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update');

const actionBody = z.object({ action: z.enum(SELLER_LISTING_ACTIONS), note: optText(300) }).strict();

const mineQuery = z.object({
  group: z.enum(MY_LISTINGS_GROUPS).default('live'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const reportBody = z
  .object({ reason: z.enum(LISTING_REPORT_REASONS), details: optText(500) })
  .strict()
  .refine((b) => b.reason !== 'something_else' || !!b.details, { message: 'Tell us what is wrong', path: ['details'] });

const listingRoutes: FastifyPluginAsync = async (fastify) => {
  const user = { schema: { tags }, preHandler: fastify.requireUser };
  const optionalUser = { schema: { tags }, preHandler: fastify.optionalUser };

  // My listings: counts per group plus one page (§10).
  fastify.get('/listings/mine', user, async (request) => {
    const { group, page } = mineQuery.parse(request.query);
    return { data: await listMine(fastify.db, request.user!, group, page) };
  });

  // Public listing page (§8.1): the owner gets the owner view; anyone else a public listing or 404.
  fastify.get('/listings/:id', optionalUser, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await getListing(fastify.db, id, request.user) };
  });

  // Other side (§9.1): public, or the owner's own listing in any status ("Find the other side" from My listings).
  fastify.get('/listings/:id/other-side', optionalUser, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await findOtherSide(fastify.db, id, request.user) };
  });

  // The owner view in any status (removed only when an admin removed it in the last 30 days).
  fastify.get('/listings/:id/owner', user, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await getOwnerView(fastify.db, request.user!, id) };
  });

  // Report listing (§8.4): 10 per user per 24 h, counted on the table.
  fastify.post('/listings/:id/reports', user, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = reportBody.parse(request.body);
    const data = await fastify.db.transaction((tx) => createReport(tx, request.user!, id, { reason: body.reason, details: body.details ?? null }));
    return reply.status(201).send({ data });
  });

  fastify.post('/listings', { ...user, config: perUser(30) }, async (request, reply) => {
    const { kind, partRequestId } = createBody.parse(request.body);
    const data = await fastify.db.transaction((tx) => createListing(tx, request.user!, { kind, partRequestId }));
    return reply.status(201).send({ data });
  });

  fastify.patch('/listings/:id', { ...user, config: perUser(240) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const patch = patchBody.parse(request.body) as ListingPatchInput;
    return { data: await runTx(fastify, (tx) => patchListing(tx, request.user!, id, patch)) };
  });

  // Drafts only. Its media objects are deleted and purged after commit, best-effort (§6.1, plan Task 13).
  fastify.delete('/listings/:id', { ...user, config: perUser(60) }, async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteDraftWithMedia(fastify.db, request.user!, id, request.log);
    return { data: { id, deleted: true } };
  });

  // Publish (from draft) or resubmit (from rejected) through the go-live gate (§5.5): `{ listing, outcome }`.
  fastify.post('/listings/:id/publish', { ...user, config: perUser(30) }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await runTx(fastify, (tx) => publishListing(tx, request.user!, id)) };
  });

  // Seller actions of §7.2 (pause, resume, renew, mark sold / unavailable, relist, remove). M14 §7.1 retired mark rented
  // and end rental: a rental's `rented` follows its booking calendar.
  fastify.post('/listings/:id/actions', { ...user, config: perUser(60) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { action, note } = actionBody.parse(request.body);
    return { data: await runTx(fastify, (tx) => applySellerAction(tx, request.user!, id, action, note ?? null)) };
  });
};

export default listingRoutes;
