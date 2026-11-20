import type { PartRequestPrefill } from '@mpm/shared-types';

/**
 * Runs a guest's pending "Post a requirement" (F8 spec §13.2) once sign-in and onboarding are done: opens the form
 * prefilled (`PostRequirement { prefill }`). Called by `runPendingAction` (`hooks/use-saved.ts`). It never posts: the
 * user reviews the form and taps Post.
 */
export function openPendingRequest(_prefill: PartRequestPrefill): void {
  // F8-STUB(B2): navigate to PostRequirement { prefill } once the navigator is ready (as openPendingContact does).
}
