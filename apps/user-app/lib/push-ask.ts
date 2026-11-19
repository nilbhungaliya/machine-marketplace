/**
 * When the app asks for push permission (F6 + F7 spec §11.6): once, at a moment the user expects replies — opening
 * Chats, after sending an enquiry or an offer, after publishing a listing — through the explainer first. L6 calls it on
 * Chats open and enquiry sent, L7 on offer sent, L8 on the sell wizard's Published screen.
 */

export type PushAskTrigger = 'enquiry' | 'offer' | 'publish' | 'chats';

// F6F7-STUB(L8): L8-3 shows the explainer once, then the system prompt, and registers the device.
export async function askPushOnce(_trigger: PushAskTrigger): Promise<void> {
  return;
}
