/**
 * "Share my number with [business] for this deal" (F6 + F7 spec §6.6): the consent tick, on the Deal record and the
 * thread banner once a deal exists.
 */
export interface ShareNumberSheetProps {
  threadId: string;
  counterpartName: string;
  visible: boolean;
  onClose: () => void;
}

// F6F7-STUB(L6): L6-4 builds the sheet.
export default function ShareNumberSheet(_props: ShareNumberSheetProps) {
  return null;
}
