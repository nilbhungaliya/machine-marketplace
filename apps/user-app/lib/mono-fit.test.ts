import { describe, expect, it } from 'vitest';
import { ELLIPSIS, fitMonoText, monoEms } from './mono-fit';

const PLATE = { maxWidth: 200, size: 12.5, minSize: 7 };

describe('monoEms', () => {
  it('advances every Latin glyph by 0.6 em', () => {
    expect(monoEms('ABC 12')).toBeCloseTo(3.6);
    expect(monoEms('A · B…')).toBeCloseTo(3.6);
  });
  it('gives Indic vowel signs no width', () => {
    // की = क + ी: one letter wide.
    expect(monoEms('की')).toBeCloseTo(0.8);
    expect(monoEms('શ્રી')).toBeCloseTo(1.6);
  });
});

describe('fitMonoText', () => {
  it('keeps a short name at full size', () => {
    const f = fitMonoText('SHREE AMBICA', PLATE);
    expect(f).toEqual({ text: 'SHREE AMBICA', fontSize: 12.5, width: expect.closeTo(90, 5) });
  });

  it('shrinks a long name to the width', () => {
    const f = fitMonoText('SHREE AMBICA ENGINEERING WORKS', PLATE); // 30 chars × 0.6 = 18 em
    expect(f.text).toBe('SHREE AMBICA ENGINEERING WORKS');
    expect(f.fontSize).toBeCloseTo(200 / 18);
    expect(f.width).toBeCloseTo(200);
  });

  it('cuts a very long name with an ellipsis at the smallest size', () => {
    const f = fitMonoText('A'.repeat(80), PLATE);
    expect(f.fontSize).toBe(7);
    expect(f.text.endsWith(ELLIPSIS)).toBe(true);
    expect(f.width).toBeLessThanOrEqual(200);
    expect(f.width).toBeGreaterThan(195);
  });

  it('does not leave a space before the ellipsis', () => {
    const f = fitMonoText(`${'A'.repeat(45)} ${'B'.repeat(30)}`, PLATE);
    expect(f.text).toBe(`${'A'.repeat(45)}${ELLIPSIS}`);
  });

  it('trims and collapses whitespace; a blank name is an empty line', () => {
    expect(fitMonoText('  Hitesh   Patel ', PLATE).text).toBe('Hitesh Patel');
    expect(fitMonoText('   ', PLATE)).toEqual({ text: '', fontSize: 12.5, width: 0 });
  });

  it('never splits a surrogate pair', () => {
    const f = fitMonoText('😀'.repeat(60), PLATE);
    expect(f.text.endsWith(ELLIPSIS)).toBe(true);
    expect(Array.from(f.text.slice(0, -1)).every((c) => c === '😀')).toBe(true);
  });
});
