import type { PendingBookingAction, PendingContactAction } from '@/lib/pending-action';

/** How long to wait for the navigator to be ready after sign-in (it re-renders the signed-in group first). */
const READY_TRIES = 20;
const READY_STEP_MS = 100;

/**
 * Runs a guest's pending contact action (F6 + F7 spec §15.2) once sign-in and onboarding are done: reopens the listing
 * with the sheet the guest tapped (`Listing { listingId, openSheet }`). Called by `runPendingAction`
 * (`hooks/use-saved.ts`), which sends only `save` to the save path. It never sends anything itself: the listing page
 * opens the sheet (`arrivalAction`) and the user taps Send.
 */
export function openPendingContact(pending: PendingContactAction): void {
  // Loaded lazily: the navigation container ref pulls in React Navigation, which the runner's Node tests can't load.
  void import('@/navigation/navigationRef').then(({ navigationRef }) => {
    let tries = 0;
    const go = () => {
      if (!navigationRef.isReady()) {
        if (++tries < READY_TRIES) setTimeout(go, READY_STEP_MS);
        return;
      }
      navigationRef.navigate('Listing', { listingId: pending.listingId, openSheet: pending.type });
    };
    // After the navigator has committed the signed-in group (the runner fires in the same effect pass).
    setTimeout(go, 0);
  });
}

/**
 * Runs a guest's pending "Request booking" (M14 spec §14.2) once sign-in and onboarding are done: opens the Request
 * booking screen for that listing (with the guest's prefill). It never sends a request: the user reviews and taps Send.
 */
export function openPendingBooking(pending: PendingBookingAction): void {
  void import('@/navigation/navigationRef').then(({ navigationRef }) => {
    let tries = 0;
    const go = () => {
      if (!navigationRef.isReady()) {
        if (++tries < READY_TRIES) setTimeout(go, READY_STEP_MS);
        return;
      }
      navigationRef.navigate('RequestBooking', pending.prefill
        ? { listingId: pending.listingId, prefill: pending.prefill }
        : { listingId: pending.listingId });
    };
    setTimeout(go, 0);
  });
}
