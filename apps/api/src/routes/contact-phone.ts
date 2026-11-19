import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OTP_LENGTH } from '@mpm/shared-types';
import { ConflictError } from '../lib/errors.js';
import { ownerOnly } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';
import { runTx } from '../lib/tx-effects.js';
import { removeContactPhone, sendContactPhoneOtp, verifyContactPhone } from '../services/business/contact-phone.service.js';

// The business contact number (F6 + F7 spec §5.12, §6.6, §12.2): owner only (`403 OWNER_ONLY`), F1-style OTP and
// limits (send 5, verify 10 per 10 minutes).

const tags = ['Businesses'];
const sendBody = z.object({ phone: z.string().max(20) }).strict();
const verifyBody = z.object({ code: z.string().length(OTP_LENGTH) }).strict();

/** A user who hasn't finished onboarding has no business (and no owner role to check yet). */
async function needsBusiness(request: FastifyRequest): Promise<void> {
  if (!request.user?.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
}

const contactPhoneRoutes: FastifyPluginAsync = async (fastify) => {
  const owner = (max: number) => ({ schema: { tags }, preHandler: [fastify.requireUser, needsBusiness, ownerOnly], config: perUser(max) });

  // → `{ resendAfter, devCode? }` (devCode outside production only, as sign-in).
  fastify.post('/businesses/me/contact-phone/otp/send', owner(5), async (request) => {
    const { phone } = sendBody.parse(request.body);
    return { data: await sendContactPhoneOtp(fastify.redis, request.user!.businessId!, phone, (m) => request.log.info(m)) };
  });
  // → `{ contactPhone, verifiedAt }`.
  fastify.post('/businesses/me/contact-phone/otp/verify', owner(10), async (request) => {
    const { code } = verifyBody.parse(request.body);
    const user = { userId: request.user!.userId, businessId: request.user!.businessId! };
    return { data: await runTx(fastify, (tx) => verifyContactPhone(tx, fastify.redis, user, code)) };
  });
  // → `{ contactPhone: null, verifiedAt: null }` (writes a `withdraw` consent for the old number).
  fastify.delete('/businesses/me/contact-phone', owner(10), async (request) => {
    const user = { userId: request.user!.userId, businessId: request.user!.businessId! };
    return { data: await runTx(fastify, (tx) => removeContactPhone(tx, user)) };
  });
};

export default contactPhoneRoutes;
