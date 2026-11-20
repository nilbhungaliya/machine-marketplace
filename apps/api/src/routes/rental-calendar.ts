import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RENTAL_BLOCK_REASONS, RENTAL_LIMITS } from '@mpm/shared-types';
import type { Tx } from '../db/index.js';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { isRealDate, isStorableText } from '../lib/spec-check.js';
import { discoveryIpCap, discoveryRateLimits, discoveryRouteLimit } from '../services/discovery/rate-key.js';
import { getAvailability } from '../services/rentals/availability.service.js';
import { runIdempotent } from '../services/idempotency.service.js';
import { createBlockTx, deleteBlockTx, updateBlockTx } from '../services/rentals/blocks.service.js';
import { getRentalCalendar } from '../services/rentals/calendar.service.js';

// M14 rental calendar (spec §7.3, §10, §13.2; plan D2, A2-1). Lane A2 owns this file: the public availability strip
// (the discovery limiter and per-IP cap), the owner's calendar (members; viewers read) and the owner's blocks (non-viewer
// writes counted in `rental_booking_action`, D6; each takes an `Idempotency-Key`, like the booking writes). Thin: Zod `.strict()` → service → `{ data }`.

const tags = ['Rentals'];

const idParams = z.object({ id: z.string().uuid() }).strict();
const isoDate = z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)');
const windowQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();
/** Trimmed note up to 200; `''` or null clears it. */
const note = z
  .string()
  .trim()
  .max(RENTAL_LIMITS.blockNoteMax)
  .refine(isStorableText, 'contains characters that cannot be saved')
  .transform((v) => (v === '' ? null : v))
  .nullable();
const blockFields = {
  startDate: isoDate,
  endDate: isoDate,
  machines: z.number().int().min(1).max(RENTAL_LIMITS.machinesMax),
  reason: z.enum(RENTAL_BLOCK_REASONS),
  note: note.optional(),
};
const createBody = z.object(blockFields).strict();
const patchBody = z
  .object(blockFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

const rentalCalendarRoutes: FastifyPluginAsync = async (fastify) => {
  const limits = discoveryRateLimits();
  const write = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('rental_booking_action', 60, 600)],
    config: { idempotent: true },
  };
  /** An idempotent write: the service in `runIdempotent`'s transaction, `{ data }` with `status`. */
  const act = (request: FastifyRequest, reply: FastifyReply, fn: (tx: Tx) => Promise<unknown>, status = 200) =>
    runIdempotent(request, reply, fastify, async (tx) => ({ status, body: { data: await fn(tx) } }));

  // Public (§10): the discovery limiter per user / install id plus the per-IP cap. `RentalAvailabilityDay[]`.
  fastify.get(
    '/listings/:id/availability',
    {
      schema: { tags },
      onRequest: discoveryIpCap(fastify.redis, limits.ipOuter),
      preHandler: [fastify.optionalUser],
      config: discoveryRouteLimit('other', limits),
    },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const q = windowQuery.parse(request.query ?? {});
      return { data: await getAvailability(fastify.db, id, q) };
    },
  );

  // Owner members (viewers read). `RentalCalendar`.
  fastify.get('/listings/:id/calendar', { schema: { tags }, preHandler: [fastify.requireUser] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const q = windowQuery.parse(request.query ?? {});
    return { data: await getRentalCalendar(fastify.db, request.user!, id, q) };
  });

  // `RentalBlockInput` → `RentalBlockView`.
  fastify.post('/listings/:id/rental-blocks', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = createBody.parse(request.body ?? {});
    return act(request, reply, (tx) => createBlockTx(tx, request.user!, id, body), 201);
  });
  // Any of the fields → `RentalBlockView`.
  fastify.patch('/rental-blocks/:id', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = patchBody.parse(request.body ?? {});
    return act(request, reply, (tx) => updateBlockTx(tx, request.user!, id, body));
  });
  // → `{ id }`.
  fastify.delete('/rental-blocks/:id', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return act(request, reply, (tx) => deleteBlockTx(tx, request.user!, id));
  });
};

export default rentalCalendarRoutes;
