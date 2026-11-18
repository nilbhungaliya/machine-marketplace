import { describe, expect, it } from 'vitest';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT, tabBarInset } from './tab-bar';

// The floating tab bar's footprint (spec §7.5): tab screens pad their bottom by it so nothing sits under the bar.

describe('tabBarInset', () => {
  it('is the bar, its gap and 8 of breathing room above the safe area', () => {
    expect(TAB_BAR_HEIGHT).toBe(68);
    expect(TAB_BAR_GAP).toBe(12);
    expect(tabBarInset(0)).toBe(88);
    expect(tabBarInset(24)).toBe(112);
  });
});
