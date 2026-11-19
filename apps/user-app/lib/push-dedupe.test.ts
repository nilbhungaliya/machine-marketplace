import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));

import { SHOWN_PUSH_LIMIT, parseStoredKeys, rememberDeliveryKey } from './push-dedupe';

describe('rememberDeliveryKey (§11.5 foreground dedupe)', () => {
  it('says "seen" for a repeat and keeps the list', () => {
    expect(rememberDeliveryKey(['n1:1', 'n2:1'], 'n1:1')).toEqual({ seen: true, keys: ['n1:1', 'n2:1'] });
  });

  it('a new version of a grouped row is not a repeat', () => {
    expect(rememberDeliveryKey(['n1:1'], 'n1:2')).toEqual({ seen: false, keys: ['n1:1', 'n1:2'] });
  });

  it('keeps the last 100 keys, dropping the oldest', () => {
    const full = Array.from({ length: SHOWN_PUSH_LIMIT }, (_, i) => `n${i}:1`);
    const r = rememberDeliveryKey(full, 'new:1');
    expect(r.seen).toBe(false);
    expect(r.keys).toHaveLength(SHOWN_PUSH_LIMIT);
    expect(r.keys[0]).toBe('n1:1');
    expect(r.keys[r.keys.length - 1]).toBe('new:1');
    expect(rememberDeliveryKey(r.keys, 'n0:1').seen).toBe(false);
  });

  it('reads a damaged store as empty', () => {
    expect(parseStoredKeys(null)).toEqual([]);
    expect(parseStoredKeys('{oops')).toEqual([]);
    expect(parseStoredKeys('["a",1,"b"]')).toEqual(['a', 'b']);
  });
});
