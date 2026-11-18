/**
 * The sell wizard's step names (F2 spec §5.2, plan Tasks 21, 23–25): the `step` param of the `Sell` route. Which steps a
 * listing walks, and in what order, is `wizardSteps(kind, hasSides)` in `lib/sell-wizard.ts`; `preview` ends every
 * kind's list. Screen files: `screens/sell/step-<step>.tsx` (`part_details` → `step-part-details.tsx`), `preview.tsx`.
 */
export const SELL_STEPS = [
  'category',
  'part_details',
  'machine',
  'quantity',
  'rates',
  'fit',
  'side',
  'media',
  'price',
  'location',
  'preview',
] as const;

export type SellStep = (typeof SELL_STEPS)[number];
