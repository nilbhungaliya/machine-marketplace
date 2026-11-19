import type { ListingDetail, OfferView } from '@mpm/shared-types';

/**
 * Make an offer / Buy at this price / Counter / Quote (F6 + F7 spec §15.1, mockup negotiate · "Make an offer"): one
 * sheet in four modes. `listing` for `offer` / `buy` from the listing page; `threadId` + `offer` for `counter`;
 * `threadId` for the seller's `quote`.
 */
export interface OfferSheetProps {
  mode: 'offer' | 'buy' | 'counter' | 'quote';
  listing?: ListingDetail;
  threadId?: string;
  offer?: OfferView;
  visible: boolean;
  onClose: () => void;
  onSent?: (r: { threadId: string }) => void;
}

// F6F7-STUB(L7): L7-1 builds the sheet.
export default function OfferSheet(_props: OfferSheetProps) {
  return null;
}
