import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resources } from '@/locales';

let asyncStore: Record<string, string> = {};
let throws = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (throws) throw new Error('storage unavailable');
      return asyncStore[k] ?? null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (throws) throw new Error('storage unavailable');
      asyncStore[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      if (throws) throw new Error('storage unavailable');
      delete asyncStore[k];
    }),
  },
}));

import {
  forgetGuest, gatedTabScreens, isGuestRemembered, rememberGuest, shouldRestoreGuest, SIGN_IN_REASONS, tabSignInReason,
} from './sign-in-gate';

beforeEach(() => {
  asyncStore = {};
  throws = false;
});

describe('guest tab guard (spec §8.1)', () => {
  it('Home and Search stay open to guests', () => {
    expect(tabSignInReason('Home', false)).toBeNull();
    expect(tabSignInReason('Search', false)).toBeNull();
  });

  it('Post, Chats and Deals ask a guest to sign in, with their own reason', () => {
    expect(tabSignInReason('Post', false)).toBe('post');
    expect(tabSignInReason('Chats', false)).toBe('chats');
    expect(tabSignInReason('Deals', false)).toBe('deals');
  });

  it('a signed-in user is never asked', () => {
    for (const tab of ['Home', 'Search', 'Post', 'Chats', 'Deals'] as const) expect(tabSignInReason(tab, true)).toBeNull();
  });

  it('every reason has its sheet copy in en, hi and gu', () => {
    for (const lang of ['en', 'hi', 'gu'] as const) {
      const sheet = resources[lang].translation.auth.signInSheet as unknown as Record<string, Record<string, string>>;
      for (const reason of SIGN_IN_REASONS) {
        expect(sheet.title[reason], `${lang} title.${reason}`).toBeTruthy();
        expect(sheet.body[reason], `${lang} body.${reason}`).toBeTruthy();
      }
    }
  });
});

describe('tab navigator screens (spec §8.1)', () => {
  const screens = {
    Post: { member: 'PostScreen', guest: 'GuestPostTab' },
    Chats: { member: 'ChatsScreen', guest: 'GuestChatsTab' },
    Deals: { member: 'DealsScreen', guest: 'GuestDealsTab' },
  };

  it('a guest gets the guest gate on Post, Chats and Deals', () => {
    expect(gatedTabScreens(false, screens)).toEqual({ Post: 'GuestPostTab', Chats: 'GuestChatsTab', Deals: 'GuestDealsTab' });
  });

  it('a signed-in user gets the real screens', () => {
    expect(gatedTabScreens(true, screens)).toEqual({ Post: 'PostScreen', Chats: 'ChatsScreen', Deals: 'DealsScreen' });
  });
});

describe('cold start: back to the guest tabs?', () => {
  it('only when no session was saved; a refused one goes to Welcome', () => {
    expect(shouldRestoreGuest('none')).toBe(true);
    expect(shouldRestoreGuest('rejected')).toBe(false);
    expect(shouldRestoreGuest('signed_in')).toBe(false);
  });
});

describe('remembered guest choice ("Browse first")', () => {
  it('is off on a fresh install, on after Browse first, off again after forget', async () => {
    expect(await isGuestRemembered()).toBe(false);
    await rememberGuest();
    expect(await isGuestRemembered()).toBe(true);
    await forgetGuest();
    expect(await isGuestRemembered()).toBe(false);
  });

  it('a storage failure reads as not remembered and never throws', async () => {
    throws = true;
    await expect(rememberGuest()).resolves.toBeUndefined();
    await expect(forgetGuest()).resolves.toBeUndefined();
    expect(await isGuestRemembered()).toBe(false);
  });
});
