import type { GstDetails } from '@mpm/shared-types';
import { ServiceUnavailableError } from '../../lib/errors.js';
import { getGstMode } from './gst-mode.js';
import { gstStub } from './gst-stub.js';

/**
 * The GST provider (F1 + A2 spec §5.1; textile `services/verification/gst-provider.ts`): the registration lookup and
 * the registered-contact code. The provider owns the code; we keep only its reference and a masked hint. Only the
 * fields the product uses come back (`GstDetails`); the full provider response is never stored.
 */
export type GstLookup = { kind: 'found'; ref: string; details: GstDetails } | { kind: 'not_found' } | { kind: 'unavailable' };

export interface GstProvider {
  lookup(gstin: string): Promise<GstLookup>;
  sendContactOtp(gstin: string): Promise<{ ref: string; hint: string } | { kind: 'unavailable' }>;
  verifyContactOtp(ref: string, code: string): Promise<boolean>;
}

const unavailable = () => new ServiceUnavailableError('The GST service is not configured', 'GST_UNAVAILABLE');

/** Mode `review`: no instant path. Every call refuses with `503 GST_UNAVAILABLE`; a code never verifies. */
const unconfigured: GstProvider = {
  lookup: async () => {
    throw unavailable();
  },
  sendContactOtp: async () => {
    throw unavailable();
  },
  verifyContactOtp: async () => false,
};

let provider: GstProvider | null = null;

/** Registered from `index.ts` once a real adapter exists. Tests may swap it. */
export function setGstProvider(p: GstProvider): void {
  provider = p;
}

/** Whether an adapter is registered (one half of `live` mode; `GST_API_KEY` is the other). */
export function hasGstProvider(): boolean {
  return provider !== null;
}

/**
 * The provider for the current mode (`getGstMode()`): `live` → the registered adapter; `stub` → the stub, even when an
 * adapter is registered (a developer with an adapter but no key never calls the real service); `review` → one that
 * answers `503 GST_UNAVAILABLE`.
 */
export function getGstProvider(): GstProvider {
  const mode = getGstMode();
  if (mode === 'live' && provider) return provider;
  if (mode === 'stub') return gstStub;
  return unconfigured;
}

/** Back to the default (tests). */
export function resetGstProvider(): void {
  provider = null;
}
