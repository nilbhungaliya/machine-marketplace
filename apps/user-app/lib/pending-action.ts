import type { OnboardingStep } from '@mpm/shared-types';

// The action a guest was taking when the app asked them to sign in (F4 + F5 spec §8.1, R12). Kept in the auth slice
// as plain data (serialisable), run once after OTP **and** onboarding finish, dropped on cancel. Only Save for now;
// Enquire / Offer join with F6.

export type PendingAction = { type: 'save'; listingId: string };

export function isPendingAction(value: unknown): value is PendingAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.type === 'save' && typeof v.listingId === 'string' && v.listingId !== '';
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
