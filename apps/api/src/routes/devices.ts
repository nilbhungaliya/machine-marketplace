import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DEVICE_PLATFORMS } from '@mpm/shared-types';
import { registerDevice, removeDevice } from '../services/notifications/devices.service.js';
import { recordInstallSighting } from '../services/fraud/sightings.js';

// Push devices (F6 + F7 spec §11.6, §12.2). L4 owns this file. Per-user state: viewers may.

const tags = ['Notifications'];

const installId = z.string().trim().min(8).max(200);
const deviceBody = z
  .object({
    installId,
    fcmToken: z.string().trim().min(1).max(4096),
    platform: z.enum(DEVICE_PLATFORMS),
    appVersion: z.string().trim().max(50).nullable().optional(),
  })
  .strict();
const installParams = z.object({ installId });

const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  const user = { schema: { tags }, preHandler: [fastify.requireUser] };

  // After sign-in, on token refresh and on app start; the install is taken away from any other account.
  fastify.put('/users/me/devices', user, async (request) => {
    const body = deviceBody.parse(request.body ?? {});
    await fastify.db.transaction((tx) => registerDevice(tx, request.user!.userId, body));
    // Admin close-out §5.4: the install's sighting (from the `X-Install-Id` header); never fails the request.
    try {
      await recordInstallSighting(fastify.db, request.user!.userId, request.headers['x-install-id']);
    } catch (err) {
      request.log.warn({ err }, 'install sighting failed');
    }
    return { data: { registered: true } };
  });

  // Sign-out.
  fastify.delete('/users/me/devices/:installId', user, async (request) => {
    const { installId: id } = installParams.parse(request.params);
    await removeDevice(fastify.db, request.user!.userId, id);
    return { data: { removed: true } };
  });
};

export default deviceRoutes;
