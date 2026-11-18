// Splits a translated sentence around an interpolated value (spec §5.2), so the value alone can be styled (a GSTIN in
// JetBrains Mono) without changing the copy. Pure.

/** `[before, value, after]` at the value's first occurrence; `null` when the value is empty or not in the text. */
export function splitOnValue(text: string, value: string): [string, string, string] | null {
  if (!value) return null;
  const at = text.indexOf(value);
  if (at < 0) return null;
  return [text.slice(0, at), value, text.slice(at + value.length)];
}
