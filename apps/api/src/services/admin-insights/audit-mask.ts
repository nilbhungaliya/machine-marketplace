import { maskContact } from '../../lib/mask-contact.js';

/**
 * Audit snapshot masking (admin close-out R16, §11.3). The viewer shows `before` / `after` masked by default:
 * - a sensitive key's whole value becomes `'•••'` (objects and arrays included): `phone`, `email`, `pan`, `address`,
 *   a key ending in `Phone` / `Email` / `Pan` / `Address` (`ownerPan`, `gstAddress`, `siteAddress`), one starting with
 *   them followed by a capital (`phoneE164`, `addressLine1`), and their snake_case forms (`contact_phone`,
 *   `pan_number`); the same for `gstin` (`gstin`, `ownerGstin`, `gstIn`, `gst_in`). The match is anchored, so
 *   `company`, `expand` or `japan` stay as they are;
 * - every other string goes through `maskContact` (phones in Latin, Devanagari and Gujarati digits, emails), and
 *   objects and arrays are walked.
 * Null stays null (it says nothing).
 */

export const MASKED = '•••';

const WORDS = 'phone|email|pan|address|gstin';
const CAPITALISED = 'Phone|Email|Pan|Address|Gstin|GstIn|GSTIN';
const SENSITIVE_KEY = new RegExp(
  `^(${WORDS}|gstIn|gst_in)$|(${CAPITALISED})$|^(${WORDS})[A-Z]|_(${WORDS}|gst_in)$|^(${WORDS})_`,
);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function maskSnapshot(value: unknown): unknown {
  if (typeof value === 'string') return maskContact(value);
  if (Array.isArray(value)) return value.map(maskSnapshot);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        isSensitiveKey(k) && v !== null && v !== undefined ? MASKED : maskSnapshot(v),
      ]),
    );
  }
  return value;
}

/** Top-level keys whose JSON differs between before and after (either side may be missing or not an object), sorted. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const obj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const b = obj(before);
  const a = obj(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null)).sort();
}
