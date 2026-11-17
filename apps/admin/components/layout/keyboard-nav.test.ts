import { describe, expect, it } from 'vitest';
import { pickInDirection, type Box } from './keyboard-nav';

const box = (left: number, top: number, w = 100, h = 30): Box => ({ left, top, right: left + w, bottom: top + h });

// A 2×2 grid of controls, plus one far-off item.
const source = box(0, 0);
const items = [
  { item: 'right', box: box(150, 0) },
  { item: 'below', box: box(0, 60) },
  { item: 'diagonal', box: box(150, 60) },
  { item: 'farRight', box: box(600, 0) },
];

describe('pickInDirection', () => {
  it('picks the nearest control in the arrow direction', () => {
    expect(pickInDirection(source, items, 'right')).toBe('right');
    expect(pickInDirection(source, items, 'down')).toBe('below');
  });

  it('prefers a control in line over a nearer diagonal one', () => {
    expect(pickInDirection(box(150, 60), items, 'up')).toBe('right');
  });

  it('returns null when nothing lies in that direction', () => {
    expect(pickInDirection(source, items, 'left')).toBeNull();
    expect(pickInDirection(source, items, 'up')).toBeNull();
  });

  it('keeps DOM order on a tie', () => {
    const twins = [{ item: 'first', box: box(150, 0) }, { item: 'second', box: box(150, 0) }];
    expect(pickInDirection(source, twins, 'right')).toBe('first');
  });
});
