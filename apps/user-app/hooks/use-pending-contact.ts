import type { PendingContactAction } from '@/lib/pending-action';

/**
 * Runs a guest's pending contact action (F6 + F7 spec §15.2) once sign-in and onboarding are done: reopens the listing
 * with the sheet the guest tapped (`Listing { listingId, openSheet }`). Called by `runPendingAction`
 * (`hooks/use-saved.ts`), which sends only `save` to the save path.
 */
// F6F7-STUB(L7): L7-2 navigates to `Listing` with `openSheet`.
export function openPendingContact(_pending: PendingContactAction): void {
  return;
}
