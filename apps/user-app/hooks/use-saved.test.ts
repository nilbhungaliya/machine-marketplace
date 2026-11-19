import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null) }));
vi.mock('react-native-toast-message', () => ({ default: { show: vi.fn() } }));
vi.mock('posthog-react-native', () => ({ default: class {} }));

import { createSaveToggle } from './use-saved';

function card(id: string, ref: number) {
  return { id, ref, saved: false, title: id };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the heart rolls back only its own listing (spec §8.5)', () => {
  it('two toggles in flight: A fails, B succeeds → A reverted, B stays saved', async () => {
    const qc = new QueryClient();
    const key = ['discover', 'home', 'origin'];
    qc.setQueryData(key, { cards: [card('A', 1), card('B', 2)] });
    const calls = { A: deferred(), B: deferred() } as Record<string, ReturnType<typeof deferred>>;
    const save = vi.fn((id: string) => calls[id]!.promise);
    const toggle = createSaveToggle(qc, { save, unsave: vi.fn() });

    const a = toggle('A', false);
    const b = toggle('B', false);
    const saved = () => (qc.getQueryData(key) as { cards: Array<{ id: string; saved: boolean }> }).cards.map((c) => c.saved);
    expect(saved()).toEqual([true, true]);

    calls.B!.resolve();
    await b;
    calls.A!.reject({ response: { status: 500, data: { code: 'INTERNAL' } } });
    await a;

    expect(saved()).toEqual([false, true]);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
