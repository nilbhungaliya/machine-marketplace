import { sql, type SQL } from 'drizzle-orm';
import type { CsvCell } from '../../lib/csv.js';
import type { CsvExportSpec } from './run-export.js';

// What the five sheets share (admin close-out §10, plan A4-3): the keyset cursor over `(created_at, id)` newest first,
// enum labels as the admin shows them, and the part of a `runCsvExport` spec a sheet builds (the route adds the admin
// and the sheet).

/** A sheet's export: header, count and keyset pages over the list's own `WHERE`, plus what the audit row records. */
export type SheetExport = Pick<CsvExportSpec<Keyset>, 'header' | 'count' | 'page' | 'filters' | 'includeContacts'>;

/** The last row of a page: its `created_at` as Postgres prints it (microseconds kept) and its id. */
export interface Keyset {
  t: string;
  id: string;
}

/** The highest uuid: the first cursor `(asOf, KEYSET_MAX_ID)` takes every row created up to the snapshot. */
export const KEYSET_MAX_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** The first page's cursor: just past the export's snapshot (`runCsvExport`'s `asOf`). */
export const startAt = (asOf: string): Keyset => ({ t: asOf, id: KEYSET_MAX_ID });

/** `created_at` as full-precision text, so the next page's `<` comparison never skips or repeats a row. */
export const keysetTime = (col: SQL): SQL => sql`to_json(${col})#>>'{}'`;

/** Rows created up to the snapshot (the count's side of `startAt`). */
export const upTo = (createdAt: SQL, asOf: string): SQL => sql`${createdAt} <= ${asOf}::timestamptz`;

/** `(created_at, id) < cursor` (newest first); the first page's cursor is `startAt(asOf)`. */
export function before(createdAt: SQL, id: SQL, after: Keyset | null, asOf: string): SQL {
  const c = after ?? startAt(asOf);
  return sql`(${createdAt}, ${id}) < (${c.t}::timestamptz, ${c.id}::uuid)`;
}

/** The cursor after this page, or null when it was the last (fewer rows than a page). */
export function nextOf(rows: Array<{ sort_at: string; id: string }>, pageSize: number): Keyset | null {
  const last = rows[rows.length - 1];
  return rows.length === pageSize && last ? { t: last.sort_at, id: last.id } : null;
}

/** Words an admin reads where the generic rule ("pending_review" → "Pending review") isn't the admin's wording. */
const LABELS: Record<string, string> = {
  rented: 'On rent',
  on_rent: 'On rent',
  machine_rental: 'Machine for rent',
  not_submitted: 'Not submitted',
  price_on_request: 'Price on request',
  any_seller: 'Any seller',
  verified_only: 'Verified sellers only',
  radius_50: 'Within 50 km',
  radius_200: 'Within 200 km',
  state: 'Same state',
  all_india: 'All India',
};

/** An enum value as the admin labels it (`apps/admin/lib/status.ts` `statusLabel`); empty for null. */
export function enumLabel(value: string | null | undefined): string {
  if (!value) return '';
  if (LABELS[value]) return LABELS[value];
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Several enum values as labels, `; `-separated. */
export const enumLabels = (values: readonly string[] | null | undefined): string => (values ?? []).map(enumLabel).join('; ');

/** A count column as a number cell. */
export const n = (v: number | string | null | undefined): CsvCell => (v === null || v === undefined ? 0 : Number(v));
