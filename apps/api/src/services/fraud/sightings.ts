import { sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { installSightings } from '../../db/schema.js';
import { installHash } from './hash.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records that an install was used by a user (admin close-out §5.4): upserts `install_sightings` (SHA-256 of the
 * `X-Install-Id` header, never the raw id) on a successful OTP sign-in and on `PUT /users/me/devices`, bumping
 * `last_seen_at` when the pair was seen before. A missing or non-UUID header writes nothing. Callers never let it fail
 * the request.
 */
export async function recordInstallSighting(conn: Db, userId: string, installIdHeader: unknown): Promise<void> {
  const raw = Array.isArray(installIdHeader) ? installIdHeader[0] : installIdHeader;
  if (typeof raw !== 'string') return;
  const installId = raw.trim();
  if (!UUID.test(installId)) return;
  await conn
    .insert(installSightings)
    .values({ installHash: installHash(installId), userId })
    .onConflictDoUpdate({
      target: [installSightings.installHash, installSightings.userId],
      set: { lastSeenAt: sql`now()` },
    });
}
