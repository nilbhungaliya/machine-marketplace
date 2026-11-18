// Form field classes (spec §10.2; the mockup's filled `.field`): a grey fill with no border that turns white with a
// violet ring on focus. Every form imports these instead of keeping its own copy; add `font-mono` for keys and codes.

export const inputCls =
  'w-full rounded-xl border-0 bg-gray-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-600';
export const labelCls = 'mb-1.5 block text-[12.5px] font-bold text-gray-600';
export const errorCls = 'mt-1 text-xs font-semibold text-red-600';
export const checkCls = 'rounded border-gray-300 text-brand-600 focus:ring-brand-600';
