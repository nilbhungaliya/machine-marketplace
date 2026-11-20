import { useCallback, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSelector, useStore } from 'react-redux';
import Toast from 'react-native-toast-message';
import type { SavedListingsPage } from '@mpm/shared-types';
import { useBusiness } from '@/hooks/use-business';
import { discoverKeys } from '@/hooks/use-discover';
import { listingKeys } from '@/hooks/use-listing';
import { openPendingBooking, openPendingContact } from '@/hooks/use-pending-contact';
import { openPendingRequest } from '@/hooks/use-pending-request';
import { useRequireSignIn } from '@/hooks/use-require-sign-in';
import { track } from '@/lib/analytics';
import { AUTH_EVENTS, SAVED_EVENTS } from '@/lib/analytics-events';
import { i18n } from '@/lib/i18n';
import { listingErrorMessage } from '@/lib/listing-errors';
import { pendingToRun } from '@/lib/pending-action';
import { fetchSavedListings, saveListing, unsaveListing } from '@/lib/saved-api';
import { patchSaved, type HeartViewer } from '@/lib/saved-cache';
import { takePending } from '@/store/authSlice';
import type { AppDispatch, RootState } from '@/store';

// Saved listings (F4 + F5 spec §8.5): the heart's optimistic toggle, the saved list, and the guest's pending Save that
// finishes after sign-in. Analytics carry the listing id only.

/** Sets `saved` on every cached copy of the listing's card (discovery lists and the listing pages). */
export function applySaved(qc: QueryClient, listingId: string, saved: boolean): void {
  for (const queryKey of [discoverKeys.all, listingKeys.all]) {
    qc.setQueriesData({ queryKey }, (data: unknown) => patchSaved(data, listingId, saved));
  }
}

/**
 * Who is looking, for the heart: a guest, or a signed-in viewer with their business id — `undefined` while it loads,
 * so the heart never flashes on an own listing (`canShowHeart`).
 */
export function useHeartViewer(): HeartViewer {
  const signedIn = useSelector((s: RootState) => s.auth.isAuthenticated);
  const business = useBusiness(signedIn);
  if (!signedIn) return { signedIn: false };
  return { signedIn: true, businessId: business.data === undefined ? undefined : business.data?.id ?? null };
}

/** The Saved screen's list (keyset pages). */
export function useSavedListings(enabled = true) {
  return useInfiniteQuery({
    queryKey: discoverKeys.saved,
    queryFn: ({ pageParam }: { pageParam: string | null }) => fetchSavedListings(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SavedListingsPage) => last.nextCursor ?? undefined,
    enabled,
  });
}

export interface SaveToggleApi {
  save(listingId: string): Promise<unknown>;
  unsave(listingId: string): Promise<unknown>;
}

/**
 * The heart's optimistic toggle (§8.5) without React: the card flips at once in every cache; an error flips back **this
 * listing only** (other hearts in flight and newer refetches stay) and shows its message. A second tap on a listing
 * whose call is still in flight is ignored.
 */
export function createSaveToggle(qc: QueryClient, apiCalls: SaveToggleApi = { save: saveListing, unsave: unsaveListing }) {
  const inFlight = new Set<string>();
  return async (listingId: string, currentlySaved: boolean | null): Promise<void> => {
    if (inFlight.has(listingId)) return;
    inFlight.add(listingId);
    const next = !currentlySaved;
    applySaved(qc, listingId, next);
    try {
      await (next ? apiCalls.save(listingId) : apiCalls.unsave(listingId));
      track(next ? SAVED_EVENTS.listingSaved : SAVED_EVENTS.listingUnsaved, { listingId });
    } catch (err) {
      applySaved(qc, listingId, currentlySaved === true);
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    } finally {
      inFlight.delete(listingId);
      void qc.invalidateQueries({ queryKey: discoverKeys.saved });
    }
  };
}

/**
 * The heart (§8.5): `createSaveToggle` for a signed-in user. A guest gets the sign-in sheet with a pending Save,
 * finished after sign-in and onboarding (`usePendingActionRunner`).
 */
export function useSaveToggle() {
  const qc = useQueryClient();
  const { requireSignIn } = useRequireSignIn();
  const toggle = useMemo(() => createSaveToggle(qc), [qc]);

  return useCallback(
    async (listingId: string, currentlySaved: boolean | null) => {
      if (!requireSignIn({ reason: 'save', pending: { type: 'save', listingId } })) return;
      await toggle(listingId, currentlySaved);
    },
    [toggle, requireSignIn],
  );
}

/** The parts of the Redux store the pending runner needs. */
export interface PendingStore {
  getState(): Pick<RootState, 'auth'>;
  dispatch: AppDispatch;
}

/**
 * Runs a guest's pending action (§8.1) when it is ready: signed in and onboarding done. The action is taken out of the
 * auth slice **before** the call, so a second run (a re-render, a second listener) finds nothing and it runs once.
 */
export async function runPendingAction(
  store: PendingStore,
  qc: QueryClient,
  save: (listingId: string) => Promise<unknown> = saveListing,
): Promise<void> {
  const pending = pendingToRun(store.getState().auth);
  if (!pending) return;
  store.dispatch(takePending());
  // F8 §13.2: a pending "Post a requirement" opens the form prefilled; it is never posted.
  if (pending.type === 'post_request') {
    track(AUTH_EVENTS.pendingActionCompleted, { type: pending.type });
    openPendingRequest(pending.prefill);
    return;
  }
  // M14 §14.2: a pending Request booking opens the Request booking screen; nothing is sent until the user taps Send.
  if (pending.type === 'request_booking') {
    track(AUTH_EVENTS.pendingActionCompleted, { type: pending.type });
    openPendingBooking(pending);
    return;
  }
  // F6 + F7 §15.2: a pending Enquire / Offer / Buy / Ask price reopens its sheet; it is never saved.
  if (pending.type !== 'save') {
    track(AUTH_EVENTS.pendingActionCompleted, { type: pending.type });
    openPendingContact(pending);
    return;
  }
  const { listingId } = pending;
  try {
    await save(listingId);
    applySaved(qc, listingId, true);
    // The listing page may have been refetched (sign-in clears the cache) before the save landed.
    void qc.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
    // ...and so may its heart's `/discover/cards` read: refetch it, so a stale `saved: false` can't land over the patch.
    void qc.invalidateQueries({ queryKey: discoverKeys.allCards });
    void qc.invalidateQueries({ queryKey: discoverKeys.saved });
    track(AUTH_EVENTS.pendingActionCompleted, { type: pending.type });
    track(SAVED_EVENTS.listingSaved, { listingId });
    Toast.show({ type: 'success', text1: i18n.t('discover.save.saved') });
  } catch (err) {
    Toast.show({ type: 'error', text1: listingErrorMessage(err) });
  }
}

/** Mounted once in RootNavigator: runs the pending action after OTP and onboarding (`runPendingAction`). */
export function usePendingActionRunner(): void {
  const qc = useQueryClient();
  const store = useStore<RootState>();
  const pending = useSelector((s: RootState) => pendingToRun(s.auth));

  useEffect(() => {
    if (pending) void runPendingAction(store as PendingStore, qc);
  }, [pending?.type, pending && 'listingId' in pending ? pending.listingId : null]); // eslint-disable-line react-hooks/exhaustive-deps
}
