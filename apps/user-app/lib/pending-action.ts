import type { OnboardingStep } from '@mpm/shared-types';

// The action a guest was taking when the app asked them to sign in (F4 + F5 spec §8.1, R12). Kept in the auth slice
// as plain data (serialisable), run once after OTP **and** onboarding finish, dropped on cancel. Save, plus F6 + F7's
// contact actions (spec §15.2): Enquire, Make offer, Buy at this price and Ask price reopen the listing with its sheet.

/** The contact actions: run by `openPendingContact` (L7), never by the save path. */
export const PENDING_CONTACT_TYPES = ['enquire', 'offer', 'buy', 'ask_price'] as const;
export type PendingContactType = (typeof PENDING_CONTACT_TYPES)[number];

export type PendingAction = { type: 'save'; listingId: string } | { type: PendingContactType; listingId: string };
export type PendingContactAction = Extract<PendingAction, { type: PendingContactType }>;

const PENDING_TYPES: ReadonlySet<string> = new Set(['save', ...PENDING_CONTACT_TYPES]);

export function isPendingAction(value: unknown): value is PendingAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && PENDING_TYPES.has(v.type) && typeof v.listingId === 'string' && v.listingId !== '';
}

/** Where the runner sends a pending action: `save` to the save path, every contact type to `openPendingContact`. */
export function pendingRoute(pending: PendingAction): 'save' | 'contact' {
  return pending.type === 'save' ? 'save' : 'contact';
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
