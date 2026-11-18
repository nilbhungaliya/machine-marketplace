import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { APP_SETTINGS, type AppSettingsView } from '@mpm/shared-types';
import { expiryImpact, getSettings, updateSettings, type SettingsPatch } from '../../services/settings.service.js';

// Any number per known key: range and whole-number checks are the registry's (400 SETTING_INVALID with the key).
const patchBody = z
  .object(Object.fromEntries(APP_SETTINGS.map((s) => [s.key, z.number().optional()])))
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');

const impactQuery = z.object({ days: z.coerce.number().int().min(7).max(365) });

const tags = ['Admin Settings'];

// Marketplace settings (F2 spec §11.5, §12): super admin only (R30), so `requireAdminRole()` with no extra role.
const adminSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  const superAdmin = fastify.requireAdminRole();

  fastify.get('/admin/settings', { schema: { tags }, preHandler: superAdmin }, async () => {
    const view: AppSettingsView = { values: await getSettings(fastify.db), registry: APP_SETTINGS };
    return { data: view };
  });

  fastify.patch('/admin/settings', { schema: { tags }, preHandler: superAdmin }, async (request) => {
    const patch = patchBody.parse(request.body) as SettingsPatch;
    const values = await fastify.db.transaction((tx) => updateSettings(tx, request.admin!.adminId, patch));
    const view: AppSettingsView = { values, registry: APP_SETTINGS };
    return { data: view };
  });

  fastify.get('/admin/settings/expiry-impact', { schema: { tags }, preHandler: superAdmin }, async (request) => {
    const { days } = impactQuery.parse(request.query);
    return { data: { days, count: await expiryImpact(fastify.db, days) } };
  });
};

export default adminSettingsRoutes;
