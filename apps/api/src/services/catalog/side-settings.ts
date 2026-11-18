import { DEFAULT_SIDE_CONVENTION } from '@mpm/shared-types';

export interface EffectiveSides {
  effectiveHasSides: boolean;
  effectiveSideConvention: string;
}

/**
 * Left / Right / Pair settings of a node: its own value wins when set; otherwise the parent's effective value.
 * A root with nothing set has no sides and the default convention. A blank convention counts as unset.
 */
export function resolveSides(
  own: { hasSides: boolean | null; sideConvention: string | null },
  parent: EffectiveSides | null,
): EffectiveSides {
  const ownConvention = own.sideConvention?.trim() ? own.sideConvention : null;
  return {
    effectiveHasSides: own.hasSides ?? parent?.effectiveHasSides ?? false,
    effectiveSideConvention: ownConvention ?? parent?.effectiveSideConvention ?? DEFAULT_SIDE_CONVENTION,
  };
}
