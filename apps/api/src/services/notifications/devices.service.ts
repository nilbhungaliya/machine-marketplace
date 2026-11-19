import { and, eq, ne, sql } from 'drizzle-orm';
import type { DevicePlatform } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { userDevices } from '../../db/schema.js';

/**
 * Push devices (F6 + F7 spec §11.6; ported from textile `services/notifications/devices.service.ts`): one row per app
 * install, one account per install. Registering takes the install from any other account (a different person's phone
 * now: that row and its queued deliveries are deleted, never moved), and any stale install holding the same token.
 * Token refresh updates the row in place, so its queued deliveries go to the new token. Sign-out and FCM's
 * "unregistered" delete it (deliveries cascade).
 */

export interface DeviceInput {
  installId: string;
  fcmToken: string;
  platform: DevicePlatform;
  appVersion?: string | null;
}

/** `PUT /users/me/devices`. Run in a transaction. */
export async function registerDevice(tx: Tx, userId: string, input: DeviceInput): Promise<void> {
  await tx.delete(userDevices).where(and(eq(userDevices.fcmToken, input.fcmToken), ne(userDevices.installId, input.installId)));
  await tx.delete(userDevices).where(and(eq(userDevices.installId, input.installId), ne(userDevices.userId, userId)));
  await tx
    .insert(userDevices)
    .values({ userId, installId: input.installId, fcmToken: input.fcmToken, platform: input.platform, appVersion: input.appVersion ?? null })
    .onConflictDoUpdate({
      target: userDevices.installId,
      set: { fcmToken: input.fcmToken, platform: input.platform, appVersion: input.appVersion ?? null, lastSeenAt: sql`now()` },
    });
}

/** `DELETE /users/me/devices/:installId` (sign-out). Only the user's own install; repeating it is harmless. */
export async function removeDevice(conn: Db | Tx, userId: string, installId: string): Promise<void> {
  await conn.delete(userDevices).where(and(eq(userDevices.installId, installId), eq(userDevices.userId, userId)));
}

/** FCM said the token is gone. Its deliveries go with it (cascade). */
export async function deleteDevice(conn: Db | Tx, deviceId: string): Promise<void> {
  await conn.delete(userDevices).where(eq(userDevices.id, deviceId));
}
