import { describe, expect, it } from 'vitest';
import { monthGrid } from './rental-calendar';

describe('monthGrid (§7.3)', () => {
  it('starts on the Monday before the 1st, pads with the next month and has 5 or 6 rows', () => {
    const grid = monthGrid(2026, 11, []);
    expect(grid[0]![0]).toMatchObject({ date: '2026-10-26', inMonth: false });
    expect(grid.length === 5 || grid.length === 6).toBe(true);
    expect(grid.every((row) => row.length === 7)).toBe(true);
    const last = grid[grid.length - 1]!;
    expect(last[6]).toMatchObject({ date: '2026-12-06', inMonth: false });
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });

  it('reads each day: nothing free is full, some out is partial', () => {
    const grid = monthGrid(2026, 11, [
      { date: '2026-11-21', out: 5, free: 0 },
      { date: '2026-11-22', out: 3, free: 2 },
      { date: '2026-11-23', out: 0, free: 5 },
    ]);
    const cell = (date: string) => grid.flat().find((c) => c.date === date)!;
    expect(cell('2026-11-21').state).toBe('full');
    expect(cell('2026-11-22')).toMatchObject({ state: 'partial', out: 3, free: 2 });
    expect(cell('2026-11-23').state).toBe('free');
    expect(cell('2026-11-24').state).toBe('none');
  });
});
