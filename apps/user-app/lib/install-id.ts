import AsyncStorage from '@react-native-async-storage/async-storage';

// The install id (F4 + F5 spec §7, §8.1, R17): a random v4 UUID made once per install and sent as `X-Install-Id` on
// every request (`lib/api.ts`). The API keys a guest's discovery rate limits by it. It is random, says nothing about the
// person, and dies with the app (AsyncStorage). It can be faked, so it is a fairness key, not a security control:
// `Math.random` is enough when the platform has no `crypto.getRandomValues`.

export const INSTALL_ID_KEY = 'install.id.v1';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** A new random v4 UUID (lower case). */
export function newInstallId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadOrCreate(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (stored && UUID_V4.test(stored)) return stored;
  } catch {
    // Unreadable storage: a new id for this run.
  }
  const id = newInstallId();
  try {
    await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  } catch {
    // Kept in memory for this run; the next cold start makes another.
  }
  return id;
}

let current: Promise<string> | null = null;

/** The install id: read (or made) once per run; concurrent first calls share one promise. */
export function getInstallId(): Promise<string> {
  if (!current) current = loadOrCreate();
  return current;
}
