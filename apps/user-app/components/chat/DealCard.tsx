import type { ThreadDetail, ThreadMessage } from '@mpm/shared-types';

/** A deal card in the thread (F6 + F7 spec §15.1): status and terms, opens the Deal record. */
export interface DealCardProps {
  message: ThreadMessage;
  thread: ThreadDetail;
}

// F6F7-STUB(L7): L7-3 builds the card.
export default function DealCard(_props: DealCardProps) {
  return null;
}
