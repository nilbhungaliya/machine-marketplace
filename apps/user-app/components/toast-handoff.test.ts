import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_VISIBLE_MS, recordShown, clearShown, takePending, __resetHandoff } from './toast-handoff';

const T0 = 1_700_000_000_000;

describe('toast hand-off', () => {
  beforeEach(() => __resetHandoff());

  it('has nothing to hand back when no toast was shown', () => {
    expect(takePending(T0)).toBeNull();
  });

  // The regression this module exists for: a sheet that saves, toasts and
  // closes in one tick deletes the toast subtree before it ever renders.
  it('hands a toast back even though it never rendered', () => {
    recordShown({ type: 'success', text1: 'Vehicle added', text2: 'Honda City saved' }, T0);

    const pending = takePending(T0 + 40);

    expect(pending).toEqual({
      type: 'success',
      text1: 'Vehicle added',
      text2: 'Honda City saved',
      visibilityTime: DEFAULT_VISIBLE_MS - 40,
    });
  });

  it('hands it back only once', () => {
    recordShown({ type: 'success', text1: 'Vehicle added' }, T0);

    expect(takePending(T0 + 10)).not.toBeNull();
    expect(takePending(T0 + 20)).toBeNull();
  });

  it('drops a toast whose time is already up', () => {
    recordShown({ type: 'error', text1: 'Could not save vehicle' }, T0);

    expect(takePending(T0 + DEFAULT_VISIBLE_MS)).toBeNull();
  });

  it('counts down from a caller-supplied visibilityTime', () => {
    recordShown({ type: 'info', text1: 'Dev mode', visibilityTime: 1_000 }, T0);

    expect(takePending(T0 + 400)?.visibilityTime).toBe(600);
  });

  it('drops a toast that has already been dismissed', () => {
    recordShown({ type: 'success', text1: 'Vehicle added', text2: 'Honda City saved' }, T0);

    clearShown('Vehicle added', 'Honda City saved');

    expect(takePending(T0 + 100)).toBeNull();
  });

  it('ignores a dismissal reported for some other toast', () => {
    recordShown({ type: 'success', text1: 'Vehicle added' }, T0);

    clearShown('Profile updated', undefined);

    expect(takePending(T0 + 100)).not.toBeNull();
  });

  it('keeps only the most recent toast', () => {
    recordShown({ type: 'error', text1: 'Already added' }, T0);
    recordShown({ type: 'success', text1: 'Vehicle added' }, T0 + 500);

    expect(takePending(T0 + 600)?.text1).toBe('Vehicle added');
  });

  it('reports how long a live toast has left, for the drain rail', () => {
    recordShown({ type: 'success', text1: 'Vehicle added' }, T0);

    expect(takePending(T0 + 1_000)?.visibilityTime).toBe(DEFAULT_VISIBLE_MS - 1_000);
  });
});
