import { describe, expect, it } from 'vitest';
import { isFocusedState } from './app-focus';

describe('isFocusedState', () => {
  it('treats only active as focused', () => {
    expect(isFocusedState('active')).toBe(true);
    expect(isFocusedState('background')).toBe(false);
    expect(isFocusedState('inactive')).toBe(false);
  });
});
