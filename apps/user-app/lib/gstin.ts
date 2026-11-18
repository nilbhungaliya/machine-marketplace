// The GSTIN rules the API applies (format + base-36 checksum), shared so the app refuses a typo before a lookup.
export { isValidGstin, normalizeGstin, panFromGstin } from '@mpm/shared-types';
