import type { OfferView, ThreadDetail } from '@mpm/shared-types';

/** An offer in the thread (F6 + F7 spec §15.1): buttons only for the side whose turn it is; backup and reconfirm states. */
export interface OfferCardProps {
  offer: OfferView;
  thread: ThreadDetail;
}

// F6F7-STUB(L7): L7-1 builds the card.
export default function OfferCard(_props: OfferCardProps) {
  return null;
}
