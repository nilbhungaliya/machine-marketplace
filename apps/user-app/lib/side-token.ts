// The L | R side token (spec §7.4, F3): which half is filled for a part's side, or for what a buyer needs. A port of
// the mockup's `side()`. Pure.

export type SideKind = 'left' | 'right' | 'pair' | 'want-left' | 'want-right' | 'none';
/** `on`: this side; `off`: not this side; `have`: the side the buyer already has; `need`: the side they're after. */
export type HalfState = 'on' | 'off' | 'have' | 'need';

export function sideHalves(kind: SideKind): { left: HalfState; right: HalfState } {
  const left: HalfState = kind === 'left' || kind === 'pair' ? 'on' : kind === 'want-left' ? 'need' : kind === 'want-right' ? 'have' : 'off';
  const right: HalfState = kind === 'right' || kind === 'pair' ? 'on' : kind === 'want-right' ? 'need' : kind === 'want-left' ? 'have' : 'off';
  return { left, right };
}
