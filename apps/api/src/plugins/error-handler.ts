import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { isConcurrencyFailure } from '../lib/pg-errors.js';
import { Sentry } from '../lib/sentry.js';

/** Maps every thrown error to `{ error, code }`. Stack traces never reach clients. */
export default fp(async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        code: 'VALIDATION_ERROR',
      });
    }
    // A deadlock or serialization failure between two concurrent edits: expected under load, so not reported.
    if (isConcurrencyFailure(error)) {
      request.log.warn({ err: error, route: request.routeOptions?.url }, 'concurrent edit aborted');
      return reply.status(409).send({ error: 'This changed at the same time as another edit. Try again.', code: 'RETRY' });
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({ error: 'Too many requests', code: 'RATE_LIMITED' });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message, code: error.code ?? 'BAD_REQUEST' });
    }
    // Nothing above recognised it, which is the definition of a bug.
    request.log.error({ err: error, route: request.routeOptions?.url }, 'unhandled error');
    // Only this branch reports: everything above is a condition we already model.
    Sentry.captureException(error, {
      tags: { route: request.routeOptions?.url ?? request.url, method: request.method },
    });
    return reply.status(500).send({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  fastify.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: 'Route not found', code: 'NOT_FOUND' });
  });
});
