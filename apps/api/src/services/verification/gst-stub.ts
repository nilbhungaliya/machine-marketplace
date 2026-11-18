import type { GstDetails, GstStatus } from '@mpm/shared-types';
import type { GstProvider } from './gst-provider.js';

/**
 * The dev GST provider (F1 + A2 spec §5.1, mode `stub`; textile `services/verification/gst-stub.ts`): any GSTIN with a
 * valid checksum returns sample data built from it; the fixed GSTINs below take the other paths. The registered-contact
 * code is always `123456` and the masked hint always `98•••••36`. Never used in production (`getGstMode`).
 */

/** Valid checksums. */
export const STUB_GSTIN_CANCELLED = '24AAACC0000C1ZY';
export const STUB_GSTIN_NOT_FOUND = '24AAACN0000N1Z0';
export const STUB_GSTIN_UNAVAILABLE = '24AAACU0000U1ZF';

/** The same value as the login OTP's dev code. */
const STUB_CONTACT_OTP = '123456';
const STUB_HINT = '98•••••36';

type StubOutcome = GstStatus | 'not_found' | 'unavailable';

const DEFAULTS = new Map<string, StubOutcome>([
  [STUB_GSTIN_CANCELLED, 'cancelled'],
  [STUB_GSTIN_NOT_FOUND, 'not_found'],
  [STUB_GSTIN_UNAVAILABLE, 'unavailable'],
]);

/** Tests change what a GSTIN returns (a later cancellation, the provider coming back). */
const overrides = new Map<string, StubOutcome>();

/** Every GSTIN `sendContactOtp` was called for, in order (tests assert that a guard sent no code). */
const sent: string[] = [];

/** `null` puts the GSTIN back to its default. */
export function setStubGstin(gstin: string, outcome: StubOutcome | null): void {
  if (outcome === null) overrides.delete(gstin);
  else overrides.set(gstin, outcome);
}

/** Clears the overrides and the record of code sends. */
export function resetStubGstins(): void {
  overrides.clear();
  sent.length = 0;
}

/** The GSTINs a code send was asked for since the last `resetStubGstins()` (a copy). */
export function stubSentCodes(): string[] {
  return [...sent];
}

function outcomeOf(gstin: string): StubOutcome {
  return overrides.get(gstin) ?? DEFAULTS.get(gstin) ?? 'active';
}

function sampleDetails(gstin: string, status: GstStatus): GstDetails {
  const pan = gstin.slice(2, 12);
  return {
    legalName: `Sample Engineering ${pan}`,
    tradeName: `Sample Machine Works ${pan.slice(5, 9)}`,
    address: { line: `Plot ${pan.slice(5, 9)}, GIDC Phase 2`, city: 'Ahmedabad', state: 'Gujarat', pincode: '382445' },
    constitution: 'Proprietorship',
    natureOfBusiness: 'Manufacturing',
    registeredOn: '2019-04-01',
    status,
  };
}

export const gstStub: GstProvider = {
  async lookup(gstin) {
    const outcome = outcomeOf(gstin);
    if (outcome === 'unavailable') return { kind: 'unavailable' };
    if (outcome === 'not_found') return { kind: 'not_found' };
    return { kind: 'found', ref: `stub-${gstin}`, details: sampleDetails(gstin, outcome) };
  },
  async sendContactOtp(gstin) {
    sent.push(gstin);
    if (outcomeOf(gstin) === 'unavailable') return { kind: 'unavailable' };
    return { ref: `stub-otp-${gstin}`, hint: STUB_HINT };
  },
  async verifyContactOtp(_ref, code) {
    return code === STUB_CONTACT_OTP;
  },
};
