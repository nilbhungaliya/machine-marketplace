import { describe, it, expect, vi, beforeEach } from 'vitest';

let asyncStore: Record<string, string> = {};
let keychain: Record<string, string> = {};
let asyncGetThrows = false;
let asyncSetThrows = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (asyncGetThrows) throw new Error('storage unavailable');
      return asyncStore[k] ?? null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (asyncSetThrows) throw new Error('storage unavailable');
      asyncStore[k] = v;
    }),
  },
}));

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(async (k: string) => {
    delete keychain[k];
  }),
}));

async function load() {
  vi.resetModules();
  return import('./fresh-install');
}

beforeEach(() => {
  asyncStore = {};
  keychain = {};
  asyncGetThrows = false;
  asyncSetThrows = false;
});

describe('clearKeychainOnFreshInstall', () => {
  it('drops a token the iOS keychain kept across an uninstall', async () => {
    keychain.jwt_token = 'jwt-from-the-previous-install';

    const { clearKeychainOnFreshInstall } = await load();
    await expect(clearKeychainOnFreshInstall()).resolves.toBe(true);

    expect(keychain.jwt_token).toBeUndefined();
  });

  it('leaves the token alone on every launch after the first', async () => {
    const { clearKeychainOnFreshInstall } = await load();
    await clearKeychainOnFreshInstall();

    keychain.jwt_token = 'signed-in-after-the-purge';
    await expect(clearKeychainOnFreshInstall()).resolves.toBe(false);

    expect(keychain.jwt_token).toBe('signed-in-after-the-purge');
  });

  it('keeps a live session when the marker cannot be read', async () => {
    asyncStore.install_marker = '1';
    keychain.jwt_token = 'live-session';
    asyncGetThrows = true;

    const { clearKeychainOnFreshInstall } = await load();
    await expect(clearKeychainOnFreshInstall()).resolves.toBe(false);

    expect(keychain.jwt_token).toBe('live-session');
  });

  it('still purges when the marker cannot be written', async () => {
    keychain.jwt_token = 'jwt-from-the-previous-install';
    asyncSetThrows = true;

    const { clearKeychainOnFreshInstall } = await load();
    await expect(clearKeychainOnFreshInstall()).resolves.toBe(true);

    expect(keychain.jwt_token).toBeUndefined();
  });
});
