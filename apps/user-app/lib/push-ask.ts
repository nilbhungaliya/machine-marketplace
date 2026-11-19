import { markPushAsked, openPushExplainer, readPushAskState, registerForPush } from './push';

/**
 * When the app asks for push permission (F6 + F7 spec §11.6): once, at a moment the user expects replies — opening
 * Chats, after sending an enquiry or an offer, after publishing a listing — through the explainer first, then Android
 * 13's prompt. Never at app start. L6 calls it on Chats open and enquiry sent, L7 on offer sent, L8 on the sell
 * wizard's Published screen.
 */

export type PushAskTrigger = 'enquiry' | 'offer' | 'publish' | 'chats';

export const PUSH_ASK_TRIGGERS: readonly PushAskTrigger[] = ['enquiry', 'offer', 'publish', 'chats'];

export type PushAskDecision = 'register' | 'explain' | 'none';

/**
 * Pure. A phone that already allows notifications registers quietly (no explainer); otherwise the explainer shows once
 * per install, only for one of the four triggers, and only while Android can still ask (after a firm no it can't, so
 * the explainer would promise something it can't do). Anything else (app start, an unknown trigger) does nothing.
 */
export function shouldAskPush(input: { trigger: string; asked: boolean; granted: boolean; canAskAgain: boolean }): PushAskDecision {
  if (!(PUSH_ASK_TRIGGERS as readonly string[]).includes(input.trigger)) return 'none';
  if (input.granted) return 'register';
  if (input.asked || !input.canAskAgain) return 'none';
  return 'explain';
}

/** Runs the decision. Never throws; does nothing without the native module, signed out, or after the first offer. */
export async function askPushOnce(trigger: PushAskTrigger): Promise<void> {
  try {
    const state = await readPushAskState();
    if (!state) return;
    const decision = shouldAskPush({ trigger, ...state });
    if (decision === 'register') {
      void registerForPush();
    } else if (decision === 'explain') {
      await markPushAsked();
      openPushExplainer(trigger);
    }
  } catch {
    // No explainer this time; nothing else lost.
  }
}
