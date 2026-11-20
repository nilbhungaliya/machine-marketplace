import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RENTAL_BOOKING_SIDE_FILTERS, RENTAL_BOOKING_TABS } from '@mpm/shared-types';
import type { Db, Tx } from '../db/index.js';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';
import type { TxApp } from '../lib/tx-effects.js';
import { replayStoredResponse } from '../plugins/idempotency.js';
import { discoveryIpCap, discoveryRateKey, discoveryRateLimits } from '../services/discovery/rate-key.js';
import { runIdempotent } from '../services/idempotency.service.js';
import { deletePhotoKeys } from '../services/part-requests/request-photos.js';
import { bookingPhotos, getRentalBooking, listRentalBookings } from '../services/rentals/booking-read.service.js';
import { finalizeBookingPhotos, presignBookingPhoto, type BookingPhotoStep } from '../services/rentals/booking-photos.js';
import { editNotes } from '../services/rentals/notes.service.js';
import { acceptChange, confirmBooking, declineBooking, proposeChange, withdrawBooking } from '../services/rentals/proposal.service.js';
import { reportBookingProblem } from '../services/rentals/rental-disputes.js';
import {
  cancelBody,
  declineBody,
  emptyBody,
  notesBody,
  onSiteBody,
  presignBody,
  problemBody,
  rentalChangeBody,
  rentalEstimateBody,
  rentalRequestBody,
  returnedBody,
  versionBody,
} from '../services/rentals/request-input.js';
import { estimateRental, requestBooking } from '../services/rentals/request.service.js';
import { cancelBooking, confirmReturn, markOnSite, markReturned } from '../services/rentals/steps.service.js';

// M14 rental bookings (spec §13.2; plan D2, D6). Lane A1 owns this file: the estimate, the request and every
// `/rental-bookings/*` route except the review (in `reviews.ts`, A3) and the calendar / blocks (`rental-calendar.ts`,
// A2). Every write takes an `Idempotency-Key` (`config.idempotent` + `runIdempotent`), refuses a viewer (`403
// VIEWER_READ_ONLY`) and counts in its rate group: `rental_booking` (request, change: 20 / 10 min),
// `rental_booking_action` (every other booking write: 60 / 10 min). Thin: Zod-parse → service → `{ data }`.

const tags = ['Rentals'];
const idParams = z.object({ id: z.string().uuid() });
const listQuery = z
  .object({
    tab: z.enum(RENTAL_BOOKING_TABS).default('active'),
    side: z.enum(RENTAL_BOOKING_SIDE_FILTERS).default('all'),
    listingId: z.string().uuid().optional(),
    cursor: z.string().max(500).optional(),
  })
  .strict();

const rentalRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  const proposal = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('rental_booking', 20, 600)],
    config: { idempotent: true },
  };
  const action = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('rental_booking_action', 60, 600)],
    config: { idempotent: true },
  };

  /** An idempotent write: the service in `runIdempotent`'s transaction, `{ data }` with `status`. */
  const act = (request: FastifyRequest, reply: FastifyReply, fn: (tx: Tx) => Promise<unknown>, status = 200) =>
    runIdempotent(request, reply, fastify, async (tx) => ({ status, body: { data: await fn(tx) } }));

  /**
   * A step whose photos are finalised before its transaction (plan D8, F8's pattern): a reply stored for this key is
   * replayed without touching storage; otherwise the uploads are finalised (kept), the transaction runs, the finals are
   * deleted again when it fails or turns out to be a replay of a concurrent first use, and the uploads once it settled.
   */
  const actWithPhotos = async (
    request: FastifyRequest,
    reply: FastifyReply,
    bookingId: string,
    step: BookingPhotoStep,
    keys: string[],
    fn: (tx: Tx, finals: string[]) => Promise<unknown>,
  ): Promise<FastifyReply> => {
    if (keys.length > 0 && (await replayStoredResponse(request, reply))) return reply;
    const finals = await finalizeBookingPhotos(fastify.db, request.user!, bookingId, keys, step);
    let sent: FastifyReply;
    try {
      sent = await act(request, reply, (tx) => fn(tx, finals));
    } catch (err) {
      await deletePhotoKeys(finals, request.log);
      throw err;
    }
    if (reply.getHeader('idempotent-replay') === 'true') await deletePhotoKeys(finals, request.log);
    await deletePhotoKeys(keys, request.log);
    return sent;
  };

  // Public (guests by `X-Install-Id`): 60 a minute per user or install, plus the discovery per-IP cap (D6).
  fastify.post(
    '/rentals/estimate',
    {
      schema: { tags },
      onRequest: discoveryIpCap(fastify.redis, discoveryRateLimits().ipOuter),
      preHandler: [fastify.optionalUser],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) => (request.user ? `user:${request.user.userId}` : discoveryRateKey(request)),
        },
      },
    },
    async (request) => {
      const body = rentalEstimateBody.parse(request.body ?? {});
      return { data: await estimateRental(fastify.db, body) };
    },
  );

  fastify.post('/listings/:id/bookings', proposal, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = rentalRequestBody.parse(request.body ?? {});
    return act(request, reply, (tx) => requestBooking(tx, request.user!, id, body), 201);
  });

  fastify.get('/rental-bookings', read, async (request) => {
    const q = listQuery.parse(request.query ?? {});
    return { data: await listRentalBookings(fastify.db, request.user!, q) };
  });

  fastify.get('/rental-bookings/:id', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getRentalBooking(fastify.db, request.user!, id) };
  });

  fastify.post('/rental-bookings/:id/change', proposal, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = rentalChangeBody.parse(request.body ?? {});
    return act(request, reply, (tx) => proposeChange(tx, request.user!, id, body));
  });

  fastify.post('/rental-bookings/:id/confirm', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = versionBody.parse(request.body ?? {});
    return act(request, reply, (tx) => confirmBooking(tx, request.user!, id, body));
  });

  fastify.post('/rental-bookings/:id/accept', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = versionBody.parse(request.body ?? {});
    return act(request, reply, (tx) => acceptChange(tx, request.user!, id, body));
  });

  fastify.post('/rental-bookings/:id/decline', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = declineBody.parse(request.body ?? {});
    return act(request, reply, (tx) => declineBooking(tx, request.user!, id, body));
  });

  fastify.post('/rental-bookings/:id/withdraw', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return act(request, reply, (tx) => withdrawBooking(tx, request.user!, id));
  });

  fastify.post('/rental-bookings/:id/on-site', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = onSiteBody.parse(request.body ?? {});
    return actWithPhotos(request, reply, id, 'on_site', body.photoKeys ?? [], (tx, finals) =>
      markOnSite(tx, request.user!, id, { hourMeter: body.hourMeter, photoKeys: finals }),
    );
  });

  fastify.post('/rental-bookings/:id/returned', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = returnedBody.parse(request.body ?? {});
    return actWithPhotos(request, reply, id, 'return', body.photoKeys ?? [], (tx, finals) =>
      markReturned(tx, request.user!, id, {
        hourMeter: body.hourMeter,
        finalAmountPaise: body.finalAmountPaise,
        finalReason: body.finalReason,
        finalNote: body.finalNote ?? null,
        damageNote: body.damageNote ?? null,
        photoKeys: finals,
      }),
    );
  });

  fastify.post('/rental-bookings/:id/confirm-return', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return act(request, reply, (tx) => confirmReturn(tx, request.user!, id));
  });

  fastify.post('/rental-bookings/:id/cancel', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = cancelBody.parse(request.body ?? {});
    return act(request, reply, (tx) => cancelBooking(tx, request.user!, id, { reason: body.reason, note: body.note ?? null }));
  });

  // A3's `reportBookingProblem` takes an app and opens its own transaction (`runTx`); run inside this route's
  // idempotent transaction it becomes a savepoint, so the dispute, the booking status and the stored reply commit
  // together. (Its after-commit emits flush when the savepoint is released, a moment before the outer commit.)
  fastify.post('/rental-bookings/:id/problem', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = problemBody.parse(request.body ?? {});
    return actWithPhotos(request, reply, id, 'problem', body.photoKeys ?? [], async (tx, finals) => {
      const inTx: TxApp = { db: tx as unknown as Db, io: fastify.io, log: fastify.log };
      const { bookingId } = await reportBookingProblem(inTx, request.user!, id, {
        category: body.category,
        description: body.description,
        photoKeys: finals,
      });
      return getRentalBooking(tx, request.user!, bookingId);
    });
  });

  fastify.get('/rental-bookings/:id/photos', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await bookingPhotos(fastify.db, request.user!, id) };
  });

  fastify.post(
    '/rental-bookings/:id/photos/presign',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer], config: perUser(30) },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = presignBody.parse(request.body ?? {});
      return { data: await presignBookingPhoto(fastify.db, request.user!, id, body.contentType, body.contentLength) };
    },
  );

  fastify.patch('/rental-bookings/:id/notes', action, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = notesBody.parse(request.body ?? {});
    return act(request, reply, (tx) => editNotes(tx, request.user!, id, body));
  });
};

export default rentalRoutes;
