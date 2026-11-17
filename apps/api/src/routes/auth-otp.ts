import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { INDIAN_MOBILE_REGEX, OTP_LENGTH } from '@mpm/shared-types';
import { sendOtp, verifyOtp } from '../services/otp.service.js';
import { signInWithPhone } from '../services/user.service.js';

const phoneSchema = z.string().regex(INDIAN_MOBILE_REGEX, 'Enter a valid 10-digit mobile number');
const sendBody = z.object({ phone: phoneSchema });
const verifyBody = z.object({ phone: phoneSchema, code: z.string().length(OTP_LENGTH) });

const toE164 = (phone: string) => `+91${phone}`;

const authOtpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/auth/otp/send',
    { schema: { tags: ['Auth'] }, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => {
      const { phone } = sendBody.parse(request.body);
      return { data: await sendOtp(fastify.redis, toE164(phone), (m) => request.log.info(m)) };
    },
  );

  fastify.post(
    '/auth/otp/verify',
    { schema: { tags: ['Auth'] }, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request) => {
      const { phone, code } = verifyBody.parse(request.body);
      await verifyOtp(fastify.redis, toE164(phone), code);
      return { data: await signInWithPhone(fastify.db, toE164(phone)) };
    },
  );
};

export default authOtpRoutes;
