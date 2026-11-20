import type { OnboardingStep, PartRequestPrefill, RentalRequestInput } from '@mpm/shared-types';

// The action a guest was taking when the app asked them to sign in (F4 + F5 spec §8.1, R12). Kept in the auth slice
// as plain data (serialisable), run once after OTP **and** onboarding finish, dropped on cancel. Save, plus F6 + F7's
// contact actions (spec §15.2): Enquire, Make offer, Buy at this price and Ask price reopen the listing with its sheet.
// F8 §13.2: "Post a requirement" opens the form prefilled (`openPendingRequest`); it never posts by itself.
// M14 §14.2: "Request booking" on a rental listing opens Request booking (`openPendingBooking`); it never sends.

/** The contact actions: run by `openPendingContact` (L7), never by the save path. */
export const PENDING_CONTACT_TYPES = ['enquire', 'offer', 'buy', 'ask_price'] as const;
export type PendingContactType = (typeof PENDING_CONTACT_TYPES)[number];

export type PendingAction =
  | { type: 'save'; listingId: string }
  | { type: PendingContactType; listingId: string }
  | { type: 'post_request'; prefill: PartRequestPrefill }
  | { type: 'request_booking'; listingId: string; prefill?: Partial<RentalRequestInput> };
export type PendingContactAction = Extract<PendingAction, { type: PendingContactType }>;
export type PendingRequestAction = Extract<PendingAction, { type: 'post_request' }>;
export type PendingBookingAction = Extract<PendingAction, { type: 'request_booking' }>;

const LISTING_TYPES: ReadonlySet<string> = new Set(['save', ...PENDING_CONTACT_TYPES]);
const PREFILL_SOURCES: ReadonlySet<string> = new Set(['no_results', 'other_side', 'post_tab', 'copy']);

export function isPendingAction(value: unknown): value is PendingAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'post_request') {
    const p = v.prefill as Record<string, unknown> | null | undefined;
    return !!p && typeof p === 'object' && typeof p.source === 'string' && PREFILL_SOURCES.has(p.source);
  }
  if (v.type === 'request_booking') {
    const ok = typeof v.listingId === 'string' && v.listingId !== '';
    return ok && (v.prefill === undefined || (!!v.prefill && typeof v.prefill === 'object'));
  }
  return typeof v.type === 'string' && LISTING_TYPES.has(v.type) && typeof v.listingId === 'string' && v.listingId !== '';
}

/**
 * Where the runner sends a pending action: `save` to the save path, every contact type to `openPendingContact`,
 * `post_request` to `openPendingRequest` (the form, never a post), `request_booking` to `openPendingBooking` (the
 * Request booking screen, never a request).
 */
export function pendingRoute(pending: PendingAction): 'save' | 'contact' | 'request' | 'booking' {
  if (pending.type === 'save') return 'save';
  if (pending.type === 'request_booking') return 'booking';
  return pending.type === 'post_request' ? 'request' : 'contact';
}

/**
 * The pending action to run now: one is waiting, the user is signed in and onboarding is done (a new user finishes
 * Your business and Where are you? first). The runner takes it (`takePending`) before running it, so it runs once.
 */
export function pendingToRun(state: {
  isAuthenticated: boolean;
  onboarding: OnboardingStep;
  pending: PendingAction | null;
}): PendingAction | null {
  if (!state.isAuthenticated || state.onboarding !== 'done') return null;
  return isPendingAction(state.pending) ? state.pending : null;
}
