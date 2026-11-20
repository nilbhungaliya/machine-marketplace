import type { ListingKind, PartSide } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import type { ListingRow } from '../listings/locks.js';
import type { PartRequestRow } from './locks.js';

// "List a matching part" from a request (spec §9.3, plan D4): `POST /listings { kind, partRequestId }` creates a draft
// prefilled from the request and a `pending` reply that is delivered when the listing goes live. Lane A2 owns this file.

/** What `createListing` spreads over its defaults. `side` only for Left / Right / Pair (never overrides with null). */
export interface PendingReplyPrep {
  request: PartRequestRow;
  listingValues: {
    kind: ListingKind;
    title: string;
    titleNorm: string;
    partNumber: string | null;
    partNumberNorm: string | null;
    partNumberBase: string | null;
    side?: PartSide;
    categoryId: string | null;
  };
}

/**
 * Checks 1–2 of §9.3 (the request is active and the seller eligible, the kind is the request's; under the request's
 * `FOR SHARE` lock) and returns the prefill, or null without a `partRequestId`.
 */
export async function preparePendingReply(
  _tx: Tx,
  _seller: { userId: string; businessId: string },
  _partRequestId: string | undefined,
  _kind: ListingKind,
): Promise<PendingReplyPrep | null> {
  // F8-STUB(A2): validate and build the prefill.
  return null;
}

/** After the draft insert: its fitments / machine row from the request and the `pending` reply. No-op for null. */
export async function applyDraftPrefill(_tx: Tx, _prep: PendingReplyPrep | null, _listing: ListingRow): Promise<void> {
  // F8-STUB(A2): fitments, machine row and the pending reply.
}
