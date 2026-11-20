import type { PartRequestPrefill } from '@mpm/shared-types';

/** How long to wait for the navigator to be ready after sign-in (it re-renders the signed-in group first). */
const READY_TRIES = 20;
const READY_STEP_MS = 100;

/**
 * Runs a guest's pending "Post a requirement" (F8 spec §13.2) once sign-in and onboarding are done: opens the form
 * prefilled (`PostRequirement { prefill }`). Called by `runPendingAction` (`hooks/use-saved.ts`), which takes the action
 * out of the auth slice first, so it opens once. It never posts: the user reviews the form and taps Post.
 */
export function openPendingRequest(prefill: PartRequestPrefill): void {
  // Loaded lazily, as `openPendingContact`: the navigation ref pulls in React Navigation, which Node tests can't load.
  void import('@/navigation/navigationRef').then(({ navigationRef }) => {
    let tries = 0;
    const go = () => {
      if (!navigationRef.isReady()) {
        if (++tries < READY_TRIES) setTimeout(go, READY_STEP_MS);
        return;
      }
      navigationRef.navigate('PostRequirement', { prefill });
    };
    // After the navigator has committed the signed-in group (the runner fires in the same effect pass).
    setTimeout(go, 0);
  });
}
