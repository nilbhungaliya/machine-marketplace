import { describe, expect, it } from 'vitest';
import { GSTIN_PARTS, readCaliper } from './gstin-caliper';

// The GSTIN caliper (onboarding motion mockup, screen "06 GST"): the jaws span the part being typed, its cells are
// highlighted, complete well-formed parts are underlined, a full valid GSTIN opens the jaws to the whole span.

const VALID = '24AAKFS4821M1ZW';
const states = (raw: string) => readCaliper(raw).cells.map((c) => c.state).join(',');
const run = (state: string, n: number) => Array.from({ length: n }, () => state);

describe('GSTIN_PARTS', () => {
  it('covers the 15 characters in five parts', () => {
    expect(GSTIN_PARTS.map((p) => [p.start, p.end])).toEqual([[0, 2], [2, 12], [12, 13], [13, 14], [14, 15]]);
  });
});

describe('readCaliper', () => {
  it('rests at zero with empty cells when nothing is typed', () => {
    const r = readCaliper('');
    expect(r.jaws).toEqual([0, 0]);
    expect(r.part).toBeNull();
    expect(r.count).toBe(0);
    expect(r.valid).toBe(false);
    expect(r.groups).toBe('');
    expect(states('')).toBe(run('empty', 15).join(','));
  });

  it('spans the state code while it is typed', () => {
    const r = readCaliper('2');
    expect(r.part).toBe('state');
    expect(r.jaws).toEqual([0, 2]);
    expect(r.cells[0]).toEqual({ char: '2', state: 'meas' });
    expect(r.cells[1]).toEqual({ char: '', state: 'meas' });
    expect(r.cells[2].state).toBe('empty');
  });

  it('underlines a complete state code and keeps the jaws on it until the next character', () => {
    const r = readCaliper('24');
    expect(r.part).toBe('state');
    expect(r.jaws).toEqual([0, 2]);
    expect(r.cells.slice(0, 2).map((c) => c.state)).toEqual(['ok', 'ok']);
  });

  it('moves to the PAN on its first character', () => {
    const r = readCaliper('24A');
    expect(r.part).toBe('pan');
    expect(r.jaws).toEqual([2, 12]);
    expect(states('24A')).toBe(['ok', 'ok', ...run('meas', 10), ...run('empty', 3)].join(','));
    expect(r.groups).toBe('24 A');
  });

  it('leaves a malformed complete part without an underline', () => {
    expect(readCaliper('2A').cells.slice(0, 2).map((c) => c.state)).toEqual(['plain', 'plain']);
    // PAN must be 5 letters, 4 digits, 1 letter.
    expect(readCaliper('24AAKF54821M').cells.slice(2, 12).every((c) => c.state === 'plain')).toBe(true);
    expect(readCaliper('24AAKFS4821M').cells.slice(2, 12).every((c) => c.state === 'ok')).toBe(true);
  });

  it('checks the entity number and the fixed Z on their own', () => {
    expect(readCaliper('24AAKFS4821M1').cells[12].state).toBe('ok');
    expect(readCaliper('24AAKFS4821M0').cells[12].state).toBe('plain');
    expect(readCaliper('24AAKFS4821M1Z').cells[13].state).toBe('ok');
    expect(readCaliper('24AAKFS4821M1Y').cells[13].state).toBe('plain');
    expect(readCaliper('24AAKFS4821M1Z').jaws).toEqual([13, 14]);
  });

  it('opens to the full span with every cell underlined when the GSTIN is valid', () => {
    const r = readCaliper(VALID);
    expect(r.valid).toBe(true);
    expect(r.jaws).toEqual([0, 15]);
    expect(r.cells.every((c) => c.state === 'ok')).toBe(true);
    expect(r.groups).toBe('24 AAKFS4821M 1 Z W');
  });

  it('reads the text the way the lookup does: lower case and spaces', () => {
    const r = readCaliper(' 24aakfs 4821m1zw ');
    expect(r.gstin).toBe(VALID);
    expect(r.valid).toBe(true);
  });

  it('marks the check character when the checksum fails', () => {
    const r = readCaliper('24AAKFS4821M1Z6');
    expect(r.valid).toBe(false);
    expect(r.jaws).toEqual([14, 15]);
    expect(r.cells[14].state).toBe('bad');
    expect(r.cells.slice(0, 14).every((c) => c.state === 'ok')).toBe(true);
  });

  it('does not blame the check character when another part is malformed', () => {
    const r = readCaliper('2AAAKFS4821M1Z6');
    expect(r.valid).toBe(false);
    expect(r.cells[14].state).toBe('ok');
    expect(r.cells[0].state).toBe('plain');
  });

  it('shows the first 15 characters and marks the check cell when the text runs past 15', () => {
    const r = readCaliper(`${VALID}7`);
    expect(r.count).toBe(16);
    expect(r.valid).toBe(false);
    expect(r.cells.map((c) => c.char).join('')).toBe(VALID);
    expect(r.cells[14].state).toBe('bad');
    expect(r.jaws).toEqual([14, 15]);
  });
});
