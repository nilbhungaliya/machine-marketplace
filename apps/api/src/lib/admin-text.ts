import { z } from 'zod';
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN } from '@mpm/shared-types';
import { ValidationError } from './errors.js';

/**
 * An officer's reason or message (F1 + A2 spec §5.3, §5.4, §8.2): every admin action that takes one checks it here,
 * so suspend / block / revoke / release / reject / ask-for-more all answer a bad one the same way:
 * `400 VALIDATION_ERROR`, "A reason of 3 to 500 characters is required", `details.field`.
 */
export function adminText(text: string, field: 'reason' | 'message' = 'reason'): string {
  const trimmed = text.trim();
  if (trimmed.length < ADMIN_REASON_MIN || trimmed.length > ADMIN_REASON_MAX) {
    throw new ValidationError(`A ${field} of ${ADMIN_REASON_MIN} to ${ADMIN_REASON_MAX} characters is required`, { field });
  }
  return trimmed;
}

/**
 * The bodies of those routes. The schema only bounds the size (and requires a string); the 3–500 rule is
 * `adminText`'s, so a short or long reason is the service's 400 with its message, on every route.
 */
export const reasonBody = z.object({ reason: z.string().max(2000) }).strict();
export const messageBody = z.object({ message: z.string().max(2000) }).strict();
