import { isValidGstin, normalizeGstin } from '@mpm/shared-types';
import { ValidationError } from '../../lib/errors.js';

/**
 * A GSTIN as typed → its canonical form (spaces removed, upper-cased), format and checksum checked (F1 + A2 spec §5.2
 * step 1; textile `gst.service.ts` `parseGstin`). Anything else is `400 GSTIN_INVALID`.
 */
export function parseGstin(input: string): string {
  const gstin = normalizeGstin(input);
  if (!isValidGstin(gstin)) throw new ValidationError('Enter a valid 15-character GSTIN', undefined, 'GSTIN_INVALID');
  return gstin;
}
