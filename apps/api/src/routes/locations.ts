import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';
import { areasForPincode } from '../services/locations/industrial-areas.service.js';
import { lookupPincode, nearestPincode } from '../services/locations/pincode.service.js';

const pincode = z.string().regex(/^[1-9]\d{5}$/, 'must be a 6-digit pincode');
const pincodeParams = z.object({ pincode });
const pincodeQuery = z.object({ pincode });
const nearestQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const tags = ['Locations'];

// Public: no login (F1 spec §10). Thin: validate → service → `{ data }`.
const locationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/locations/pincodes/:pincode', { schema: { tags } }, async (request) => {
    const params = pincodeParams.parse(request.params);
    const data = await lookupPincode(fastify.db, params.pincode);
    if (!data) throw new NotFoundError('Pincode');
    return { data };
  });

  fastify.get('/locations/nearest-pincode', { schema: { tags } }, async (request) => {
    const { lat, lng } = nearestQuery.parse(request.query);
    const data = await nearestPincode(fastify.db, lat, lng);
    if (!data) throw new NotFoundError('Pincode near this location');
    return { data };
  });

  fastify.get('/locations/industrial-areas', { schema: { tags } }, async (request) => {
    const query = pincodeQuery.parse(request.query);
    return { data: await areasForPincode(fastify.db, query.pincode) };
  });
};

export default locationRoutes;
