export interface UserJwtPayload {
  userId: string;
  businessId: string | null;
  exp?: number;
}

/** Reads a JWT's payload WITHOUT verifying it — for client-side expiry and id only. */
export function decodeJwtPayload(token: string): UserJwtPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64));
    return typeof payload?.userId === 'string' ? payload : null;
  } catch {
    return null;
  }
}

export function isExpired(payload: UserJwtPayload, now = Date.now()): boolean {
  return payload.exp !== undefined && payload.exp * 1000 < now;
}
