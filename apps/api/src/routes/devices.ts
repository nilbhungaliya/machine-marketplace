import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../lib/member-guard.js';

// Push devices (F6 + F7 spec §11.6, §12.2). L4 owns this file; C0-4b stubs. Per-user state: viewers may.

const tags = ['Notifications'];

const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  const user = { schema: { tags }, preHandler: [fastify.requireUser] };
  // F6F7-STUB(L4): L4-4 register / refresh a device.
  fastify.put('/users/me/devices', user, async () => notImplemented());
  // F6F7-STUB(L4): L4-4 forget a device.
  fastify.delete('/users/me/devices/:installId', user, async () => notImplemented());
};

export default deviceRoutes;
