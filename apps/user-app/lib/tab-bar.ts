// The floating tab bar's geometry (spec §7.5). The bar is absolutely placed, so every tab screen pads its bottom by
// `tabBarInset` (through `useTabBarInset()`) to keep its last content and buttons out from under it.

/** The bar's height: an 8 padding around the 52 Post button. */
export const TAB_BAR_HEIGHT = 68;
/** Space between the bar and the bottom safe area. */
export const TAB_BAR_GAP = 12;

/** The bar, its gap, the safe area and 8 of breathing room above the bar. */
export function tabBarInset(bottomInset: number): number {
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + bottomInset + 8;
}
