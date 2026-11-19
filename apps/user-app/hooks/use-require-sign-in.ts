import { createContext, useCallback, useContext } from 'react';
import { useSelector } from 'react-redux';
import type { PendingAction } from '@/lib/pending-action';
import type { SignInReason } from '@/lib/sign-in-gate';
import type { RootState } from '@/store';

// Login at the moment of intent (F4 + F5 spec §8.1, R12; business rule 2). `requireSignIn` opens the sign-in sheet
// (`SignInSheetProvider` in components/SignInSheet.tsx, mounted once in App.tsx); "Continue" stores the pending action
// in the auth slice and opens the phone screen, and the runner (`usePendingActionRunner`, hooks/use-saved.ts) runs it
// once after OTP and onboarding.

export interface SignInRequest {
  reason: SignInReason;
  /** What to finish after sign-in (Save). Omit for places that just need an account (Post, Chats, Deals). */
  pending?: PendingAction | null;
}

export interface SignInSheetApi {
  /** Opens the sheet for `request`. */
  open(request: SignInRequest): void;
  /** Straight to the phone screen (Profile's guest card), dropping any pending action. */
  start(): void;
}

const noop: SignInSheetApi = { open: () => {}, start: () => {} };

export const SignInSheetContext = createContext<SignInSheetApi>(noop);

export function useRequireSignIn() {
  const sheet = useContext(SignInSheetContext);
  const signedIn = useSelector((state: RootState) => state.auth.isAuthenticated);

  /** True when signed in (carry on); otherwise opens the sign-in sheet and returns false. */
  const requireSignIn = useCallback(
    (request: SignInRequest): boolean => {
      if (signedIn) return true;
      sheet.open(request);
      return false;
    },
    [sheet, signedIn],
  );

  return { signedIn, requireSignIn, openSignIn: sheet.start };
}
