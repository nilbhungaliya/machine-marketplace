import { INDIAN_MOBILE_REGEX } from '@mpm/shared-types';

/** Digits only, with a pasted +91 / 0 prefix dropped: "+91 98250 12345" → "9825012345". */
export function normalizeMobile(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isValidMobile(input: string): boolean {
  return INDIAN_MOBILE_REGEX.test(normalizeMobile(input));
}
