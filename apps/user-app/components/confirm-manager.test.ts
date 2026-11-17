import { describe, it, expect } from 'vitest';
import { createConfirmManager } from './confirm-manager';

describe('createConfirmManager', () => {
  it('opens on confirm() and resolves true on settle(true)', async () => {
    const m = createConfirmManager(() => {});
    const p = m.confirm({ title: 'X' });
    expect(m.visible).toBe(true);
    expect(m.options?.title).toBe('X');
    m.settle(true);
    await expect(p).resolves.toBe(true);
    expect(m.visible).toBe(false);
    expect(m.options).toBeNull();
  });

  it('resolves false on settle(false)', async () => {
    const m = createConfirmManager(() => {});
    const p = m.confirm({ title: 'Y' });
    m.settle(false);
    await expect(p).resolves.toBe(false);
  });

  it('ignores a second confirm while one is open (resolves it false, keeps first)', async () => {
    const m = createConfirmManager(() => {});
    const p1 = m.confirm({ title: 'A' });
    const p2 = m.confirm({ title: 'B' });
    await expect(p2).resolves.toBe(false);
    expect(m.options?.title).toBe('A');
    m.settle(true);
    await expect(p1).resolves.toBe(true);
  });

  it('calls onChange when opening and settling', () => {
    let n = 0;
    const m = createConfirmManager(() => { n += 1; });
    m.confirm({ title: 'Z' });
    m.settle(true);
    expect(n).toBe(2);
  });

  it('choose() says which of three buttons was pressed', async () => {
    const m = createConfirmManager(() => {});
    const p = m.choose({ title: 'C', secondaryLabel: 'Keep bookings' });
    expect(m.options?.secondaryLabel).toBe('Keep bookings');
    m.settle('secondary');
    await expect(p).resolves.toBe('secondary');
  });

  it('choose() resolves confirm, and a dismissal as cancel', async () => {
    const m = createConfirmManager(() => {});
    const confirmed = m.choose({ title: 'E', secondaryLabel: 'S' });
    m.settle(true);
    await expect(confirmed).resolves.toBe('confirm');

    // Backdrop and back button settle(false): a dismissal must never pick a choice.
    const dismissed = m.choose({ title: 'F', secondaryLabel: 'S' });
    m.settle(false);
    await expect(dismissed).resolves.toBe('cancel');
  });

  it('a second settle is a no-op (no throw, value stays at first settle)', async () => {
    const m = createConfirmManager(() => {});
    const p = m.confirm({ title: 'D' });
    m.settle(true);
    m.settle(false); // must not throw, must not change the already-resolved value
    await expect(p).resolves.toBe(true);
    expect(m.visible).toBe(false);
  });

  it('keeps hideCancel on a yes/no prompt, so the sheet draws only the confirm button', async () => {
    const m = createConfirmManager(() => {});
    const p = m.confirm({ title: 'OK only', hideCancel: true });
    expect(m.options?.hideCancel).toBe(true);
    m.settle(true);
    await expect(p).resolves.toBe(true);
  });
});
