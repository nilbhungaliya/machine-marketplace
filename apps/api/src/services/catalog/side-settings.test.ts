import { describe, expect, it } from 'vitest';
import { DEFAULT_SIDE_CONVENTION } from '@mpm/shared-types';
import { resolveSides } from './side-settings.js';

const parent = { effectiveHasSides: false, effectiveSideConvention: 'Parent convention' };

describe('resolveSides', () => {
  it('own true beats a parent false', () => {
    expect(resolveSides({ hasSides: true, sideConvention: null }, parent)).toEqual({
      effectiveHasSides: true,
      effectiveSideConvention: 'Parent convention',
    });
  });

  it('own null inherits the parent', () => {
    expect(resolveSides({ hasSides: null, sideConvention: null }, { ...parent, effectiveHasSides: true })).toEqual({
      effectiveHasSides: true,
      effectiveSideConvention: 'Parent convention',
    });
  });

  it('a root with null gets false and the default convention', () => {
    expect(resolveSides({ hasSides: null, sideConvention: null }, null)).toEqual({
      effectiveHasSides: false,
      effectiveSideConvention: DEFAULT_SIDE_CONVENTION,
    });
  });

  it('own convention wins; a blank one inherits', () => {
    expect(resolveSides({ hasSides: null, sideConvention: 'Seen by the weaver' }, parent).effectiveSideConvention).toBe('Seen by the weaver');
    expect(resolveSides({ hasSides: null, sideConvention: '  ' }, parent).effectiveSideConvention).toBe('Parent convention');
  });
});
