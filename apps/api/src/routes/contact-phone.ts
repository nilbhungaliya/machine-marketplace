import type { FastifyPluginAsync } from 'fastify';
import { notImplemented, ownerOnly } from '../lib/member-guard.js';

// The business contact number (F6 + F7 spec §6.6, §12.2): owner only, F1-style OTP. L1 owns this file; C0-4b stubs.

const tags = ['Businesses'];

const contactPhoneRoutes: FastifyPluginAsync = async (fastify) => {
  const owner = { schema: { tags }, preHandler: [fastify.requireUser, ownerOnly] };
  // F6F7-STUB(L1): L1-4 send the code.
  fastify.post('/businesses/me/contact-phone/otp/send', owner, async () => notImplemented());
  // F6F7-STUB(L1): L1-4 verify and save.
  fastify.post('/businesses/me/contact-phone/otp/verify', owner, async () => notImplemented());
  // F6F7-STUB(L1): L1-4 remove (writes a `withdraw` consent).
  fastify.delete('/businesses/me/contact-phone', owner, async () => notImplemented());
};

export default contactPhoneRoutes;
