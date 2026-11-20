import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import errorHandlerPlugin from './plugins/error-handler.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import idempotencyPlugin from './plugins/idempotency.js';
import healthRoutes from './routes/health.js';
import adminAuthRoutes from './routes/admin/auth.js';
import authOtpRoutes from './routes/auth-otp.js';
import businessRoutes from './routes/businesses.js';
import gstRoutes from './routes/gst.js';
import catalogRoutes from './routes/catalog.js';
import locationRoutes from './routes/locations.js';
import listingRoutes from './routes/listings.js';
import listingMediaRoutes from './routes/listing-media.js';
import adminCatalogCategoryRoutes from './routes/admin/catalog-categories.js';
import adminCatalogFieldRoutes from './routes/admin/catalog-fields.js';
import adminCatalogBrandRoutes from './routes/admin/catalog-brands.js';
import adminCatalogMasterRoutes from './routes/admin/catalog-master.js';
import adminCatalogExportRoutes from './routes/admin/catalog-export.js';
import adminIndustrialAreaRoutes from './routes/admin/industrial-areas.js';
import adminUserRoutes from './routes/admin/users.js';
import adminVerificationRoutes from './routes/admin/verification.js';
import adminBusinessRoutes from './routes/admin/businesses.js';
import adminSettingsRoutes from './routes/admin/settings.js';
import adminModerationRoutes from './routes/admin/moderation.js';
import adminListingRoutes from './routes/admin/listings.js';
import adminListingMediaRoutes from './routes/admin/listing-media.js';
import discoverRoutes from './routes/discover.js';
import savedListingRoutes from './routes/saved-listings.js';
import adminSearchRoutes from './routes/admin/search.js';
// F6 + F7 (enquiries, chat, offers, deals, reviews, notifications)
import threadRoutes from './routes/threads.js';
import blockRoutes from './routes/blocks.js';
import contactPhoneRoutes from './routes/contact-phone.js';
import badgeRoutes from './routes/badges.js';
import offerRoutes from './routes/offers.js';
import dealRoutes from './routes/deals.js';
import reviewRoutes from './routes/reviews.js';
import notificationRoutes from './routes/notifications.js';
import deviceRoutes from './routes/devices.js';
import adminEnquiryRoutes from './routes/admin/enquiries.js';
import adminDealRoutes from './routes/admin/deals.js';
import adminDisputeRoutes from './routes/admin/disputes.js';
import adminConversationRoutes from './routes/admin/conversations.js';
import adminReportRoutes from './routes/admin/reports.js';
import adminReviewRoutes from './routes/admin/reviews.js';
import partRequestRoutes from './routes/part-requests.js';
import partRequestReplyRoutes from './routes/part-request-replies.js';
import adminPartRequestRoutes from './routes/admin/part-requests.js';

export interface BuildAppOptions {
  /** false in unit tests that must not touch Postgres/Redis. */
  infra?: boolean;
  logger?: boolean;
}

/**
 * How many proxies sit in front of the API (ported from textile `app.ts`); unset or 0 means none, as in dev and tests.
 * Without it, `request.ip` behind Caddy is Caddy's address, so every client shares one per-IP rate-limit bucket (the GST
 * lookup / code-send limits, spec §5.2). A malformed value stops the start; a well-formed but wrong count can't be
 * detected, so `buildApp` logs the count it resolved. Production (`infra/deploy`) sets 1 for Caddy.
 */
export function trustProxyHops(): number | false {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return false;
  const hops = Number(raw);
  if (!Number.isSafeInteger(hops) || hops < 0) throw new Error(`TRUST_PROXY_HOPS must be a whole number of proxies, got "${raw}"`);
  return hops === 0 ? false : hops;
}

export async function buildApp({ infra = true, logger = true }: BuildAppOptions = {}): Promise<FastifyInstance> {
  const hops = trustProxyHops();
  const app = Fastify({ logger, trustProxy: hops });
  app.log.info({ trustProxyHops: hops || 0 }, 'trusted proxy hops resolved');

  if (process.env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Machine Parts Marketplace API', version: '0.1.0' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await app.register(cors, { origin: true, credentials: true });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  // After auth, before every route: its onRoute hook adds the replay preHandler to F6 + F7 idempotent routes.
  await app.register(idempotencyPlugin);
  await app.register(healthRoutes);

  if (infra) {
    await app.register(dbPlugin);
    await app.register(redisPlugin);
    await app.register(rateLimitPlugin);
    await app.register(authOtpRoutes);
    await app.register(businessRoutes);
    await app.register(gstRoutes);
    await app.register(catalogRoutes);
    await app.register(locationRoutes);
    await app.register(listingRoutes);
    await app.register(listingMediaRoutes);
    await app.register(discoverRoutes);
    await app.register(savedListingRoutes);
    await app.register(adminAuthRoutes);
    await app.register(adminCatalogCategoryRoutes);
    await app.register(adminCatalogFieldRoutes);
    await app.register(adminCatalogBrandRoutes);
    await app.register(adminCatalogMasterRoutes);
    await app.register(adminCatalogExportRoutes);
    await app.register(adminIndustrialAreaRoutes);
    await app.register(adminUserRoutes);
    await app.register(adminVerificationRoutes);
    await app.register(adminBusinessRoutes);
    await app.register(adminSettingsRoutes);
    await app.register(adminModerationRoutes);
    await app.register(adminListingRoutes);
    await app.register(adminListingMediaRoutes);
    await app.register(adminSearchRoutes);
    await app.register(threadRoutes);
    await app.register(blockRoutes);
    await app.register(contactPhoneRoutes);
    await app.register(badgeRoutes);
    await app.register(offerRoutes);
    await app.register(dealRoutes);
    await app.register(reviewRoutes);
    await app.register(notificationRoutes);
    await app.register(deviceRoutes);
    await app.register(adminEnquiryRoutes);
    await app.register(adminDealRoutes);
    await app.register(adminDisputeRoutes);
    await app.register(adminConversationRoutes);
    await app.register(adminReportRoutes);
    await app.register(adminReviewRoutes);
    // F8 part requests (spec §12.2, §14).
    await app.register(partRequestRoutes);
    await app.register(partRequestReplyRoutes);
    await app.register(adminPartRequestRoutes);
  }

  return app;
}
