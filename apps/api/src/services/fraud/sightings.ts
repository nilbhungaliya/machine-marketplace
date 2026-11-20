import type { Db } from '../../db/index.js';

/**
 * Records that an install was used by a user (admin close-out §5.4): upserts `install_sightings` (SHA-256 of the
 * `X-Install-Id` header, never the raw id) on a successful OTP sign-in and on `PUT /users/me/devices`. A missing or
 * non-UUID header writes nothing. Callers never let it fail the request.
 */
export async function recordInstallSighting(_conn: Db, _userId: string, _installIdHeader: unknown): Promise<void> {
  // AC-STUB(A3)
}
