import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TabParamList } from '@/navigation/types';

// Guest browsing (F4 + F5 spec §8.1, R12): which places ask a guest to sign in, and the remembered "Browse first"
// choice. Login is asked only at the moment of intent (business rule 2).

/** Why the sign-in sheet opened: its title and body copy (`auth.signInSheet.{title,body}.<reason>`), analytics `reason`. */
export const SIGN_IN_REASONS = ['save', 'post', 'chats', 'deals', 'report', 'enquire', 'offer', 'request'] as const;
export type SignInReason = (typeof SIGN_IN_REASONS)[number];

const TAB_REASONS: Partial<Record<keyof TabParamList, SignInReason>> = {
  Post: 'post',
  Chats: 'chats',
  Deals: 'deals',
};

/** The sign-in reason when a guest opens this tab; null when the tab is open to guests or the user is signed in. */
export function tabSignInReason(tab: keyof TabParamList, signedIn: boolean): SignInReason | null {
  if (signedIn) return null;
  return TAB_REASONS[tab] ?? null;
}

/** What a cold start found (`loadToken`): a restored session, nothing saved, or a saved session that was refused. */
export type BootSession = 'signed_in' | 'none' | 'rejected';

/**
 * Only a cold start with no saved session goes back to the guest tabs; a refused one (expired, signed out elsewhere,
 * suspended) lands on Welcome.
 */
export function shouldRestoreGuest(boot: BootSession): boolean {
  return boot === 'none';
}

/** The tabs a guest can't use: each shows its guest gate instead of the signed-in screen. */
export type GatedTab = 'Post' | 'Chats' | 'Deals';

/** Picks each gated tab's screen: the signed-in one, or the guest gate for a guest (types kept per tab). */
export function gatedTabScreens<S extends Record<GatedTab, { member: unknown; guest: unknown }>>(
  signedIn: boolean,
  screens: S,
): { [K in GatedTab]: S[K]['member'] | S[K]['guest'] } {
  const tabs = Object.keys(screens) as GatedTab[];
  return Object.fromEntries(
    tabs.map((tab) => [tab, tabSignInReason(tab, signedIn) ? screens[tab].guest : screens[tab].member]),
  ) as { [K in GatedTab]: S[K]['member'] | S[K]['guest'] };
}

/**
 * "Browse first" is remembered, so a guest's next cold start opens the tabs again. AsyncStorage dies with the app, so a
 * fresh install still starts on Welcome. Storage errors read as "not remembered" (Welcome again) and never throw.
 */
const GUEST_KEY = 'auth.guest.v1';

export async function rememberGuest(): Promise<void> {
  try {
    await AsyncStorage.setItem(GUEST_KEY, '1');
  } catch {
    // Only the next cold start's Welcome screen depends on it.
  }
}

export async function forgetGuest(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUEST_KEY);
  } catch {
    // As above.
  }
}

export async function isGuestRemembered(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(GUEST_KEY)) === '1';
  } catch {
    return false;
  }
}
