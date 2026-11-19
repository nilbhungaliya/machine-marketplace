import { describe, it, expect, vi, beforeEach } from 'vitest';

let asyncStore: Record<string, string> = {};
let getThrows = false;
let setThrows = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (getThrows) throw new Error('storage unavailable');
      return asyncStore[k] ?? null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (setThrows) throw new Error('storage unavailable');
      asyncStore[k] = v;
    }),
  },
}));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A fresh module, as on a cold start (the in-memory copy is gone, storage is kept). */
async function load() {
  vi.resetModules();
  return import('./install-id');
}

beforeEach(() => {
  asyncStore = {};
  getThrows = false;
  setThrows = false;
});

describe('install id (spec §7, §8.1)', () => {
  it('is created once as a v4 UUID and stored', async () => {
    const { getInstallId, INSTALL_ID_KEY } = await load();
    const id = await getInstallId();
    expect(id).toMatch(UUID_V4);
    expect(asyncStore[INSTALL_ID_KEY]).toBe(id);
  });

  it('is reused within a run and after a cold start', async () => {
    const first = await load();
    const id = await first.getInstallId();
    expect(await first.getInstallId()).toBe(id);
    const second = await load();
    expect(await second.getInstallId()).toBe(id);
  });

  it('concurrent first calls agree on one id', async () => {
    const { getInstallId } = await load();
    const [a, b, c] = await Promise.all([getInstallId(), getInstallId(), getInstallId()]);
    expect(new Set([a, b, c]).size).toBe(1);
  });

  it('replaces a stored value that is not a UUID (the API would ignore it)', async () => {
    const { getInstallId, INSTALL_ID_KEY } = await load();
    asyncStore[INSTALL_ID_KEY] = 'not-a-uuid';
    const id = await getInstallId();
    expect(id).toMatch(UUID_V4);
    expect(asyncStore[INSTALL_ID_KEY]).toBe(id);
  });

  it('still answers when storage fails (an id for this run only)', async () => {
    getThrows = true;
    setThrows = true;
    const { getInstallId } = await load();
    const id = await getInstallId();
    expect(id).toMatch(UUID_V4);
    expect(await getInstallId()).toBe(id);
  });

  it('newInstallId makes different v4 UUIDs', async () => {
    const { newInstallId } = await load();
    const ids = new Set(Array.from({ length: 50 }, () => newInstallId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
