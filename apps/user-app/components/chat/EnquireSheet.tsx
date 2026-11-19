import type { ListingDetail } from '@mpm/shared-types';

/**
 * The Enquire sheet (F6 + F7 spec §15.1, mockup negotiate · "Enquire"): quick options, quantity for Best price, a
 * note, the machine line from Check my machine; `preset: 'ask_price'` opens it as "Price please".
 */
export interface EnquireSheetProps {
  listing: ListingDetail;
  visible: boolean;
  preset?: 'ask_price';
  onClose: () => void;
  onSent?: (threadId: string) => void;
}

// F6F7-STUB(L6): L6-4 builds the sheet.
export default function EnquireSheet(_props: EnquireSheetProps) {
  return null;
}
