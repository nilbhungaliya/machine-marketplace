/** Shown when a catalogue key fails CATALOG_KEY_REGEX (same rule as the API). */
export const KEY_MESSAGE = 'Use snake_case: a lowercase letter, then 1–39 of a–z, 0–9 or _';

/** "Needle Size (mm)" → "needle_size_mm": a starting key the admin can still edit. */
export function toCatalogKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/_+$/, '');
}
