import { describe, expect, it } from 'vitest';
import { sideHalves, type SideKind } from './side-token';

// The L | R token (spec §7.4, §7.6): a port of the mockup's side().

describe('sideHalves', () => {
  const cases: [SideKind, string, string][] = [
    ['left', 'on', 'off'],
    ['right', 'off', 'on'],
    ['pair', 'on', 'on'],
    ['want-left', 'need', 'have'],
    ['want-right', 'have', 'need'],
    ['none', 'off', 'off'],
  ];
  for (const [kind, left, right] of cases) {
    it(kind, () => {
      expect(sideHalves(kind)).toEqual({ left, right });
    });
  }
});
