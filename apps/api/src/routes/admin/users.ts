import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import type { Tx } from '../../db/index.js';
import { reasonBody } from '../../lib/admin-text.js';
import { runTx } from '../../lib/tx-effects.js';
import {
  blockUser,
  disconnectUserSockets,
  reinstateUser,
  suspendUser,
  unblockUser,
  type StatusActor,
  type UserStatusResult,
} from '../../services/admin/user-status.service.js';

const idParams = z.object({ id: z.string().uuid() });

const tags = ['Admin Users'];

type StatusAction = (tx: Tx, admin: StatusActor, userId: string, reason: string) => Promise<UserStatusResult>;

// Account status (F1 + A2 spec §8.2, §10). Thin: validate → service → `{ data }`. Suspend / reinstate: verification
// officers and moderators; block / unblock: super admins only (super_admin passes every role check). Suspend and block
// drop the user's open sockets after the commit. Every action runs in `runTx` (F6 + F7 plan L2-4): an owner's
// suspension or block closes offers, and their lines and `offer:updated` emits go out after the commit.
const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  const officerOrModerator = fastify.requireAdminRole('verification_officer', 'moderator');
  const superAdminOnly = fastify.requireAdminRole('super_admin');

  const route = (path: string, preHandler: preHandlerAsyncHookHandler, action: StatusAction, disconnect: boolean) =>
    fastify.post(`/admin/users/:id/${path}`, { schema: { tags }, preHandler }, async (request) => {
      const { id } = idParams.parse(request.params);
      const { reason } = reasonBody.parse(request.body ?? {});
      const admin = { id: request.admin!.adminId, role: request.admin!.role };
      const data = await runTx(fastify, (tx) => action(tx, admin, id, reason));
      // `io` is decorated only when Socket.IO is attached (index.ts, socket tests).
      if (disconnect) disconnectUserSockets(fastify.io as SocketIOServer | undefined, id);
      return { data };
    });

  route('suspend', officerOrModerator, suspendUser, true);
  route('reinstate', officerOrModerator, reinstateUser, false);
  route('block', superAdminOnly, blockUser, true);
  route('unblock', superAdminOnly, unblockUser, false);
};

export default adminUserRoutes;
