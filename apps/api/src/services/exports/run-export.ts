import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { EXPORT_PAGE_SIZE, EXPORT_ROW_CAP, type ExportSheet } from '@mpm/shared-types';
import { CSV_BOM, csvRow, type CsvCell } from '../../lib/csv.js';
import { ValidationError } from '../../lib/errors.js';
import { istToday } from '../../lib/ist.js';
import { maskContact } from '../../lib/mask-contact.js';
import type { TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';

/**
 * One export (admin close-out §10, R12, plan D10). `count` and `page` run the list's own `WHERE` builder, limited to
 * rows created up to `asOf` (the export's snapshot, full-precision `timestamptz` text); `page` takes the keyset cursor it
 * returned last (null first: it seeds its cursor just past `asOf`, e.g. sheet-kit's `startAt`) and returns up to
 * `pageSize` rows already formatted as cells (`format.ts`), with `next` null on the last page.
 */
export interface CsvExportSpec<C> {
  adminId: string;
  sheet: ExportSheet | 'audit_log';
  /** The list filters as parsed (no page / pageSize); string values reach the audit row only through `maskContact`. */
  filters: Record<string, unknown>;
  includeContacts?: boolean;
  header: string[];
  count(asOf: string): Promise<number>;
  page(after: C | null, at: ExportPageAt): Promise<{ rows: CsvCell[][]; next: C | null }>;
  /** Defaults to `EXPORT_ROW_CAP`; a test passes a small one. */
  cap?: number;
  /** Defaults to `EXPORT_PAGE_SIZE`; a test passes a small one. */
  pageSize?: number;
}

/** What every page of one export shares: its snapshot and its page size. */
export interface ExportPageAt {
  asOf: string;
  pageSize: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filter values as the audit row keeps them: every string (in arrays and objects too) through `maskContact`, except a
 * whole uuid (an id filter carries no contact, and its digit groups can look like a phone number to `maskContact`).
 */
export function maskFilterValues(value: unknown): unknown {
  if (typeof value === 'string') return UUID.test(value) ? value : maskContact(value);
  if (Array.isArray(value)) return value.map(maskFilterValues);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskFilterValues(v)]));
  }
  return value;
}

/**
 * Count → over the cap `400 EXPORT_TOO_LARGE` (`details.total`, no audit row: never silent truncation) → the
 * `export.create` audit row in its own transaction (sheet, masked filters, row count, contacts flag; never a cell) →
 * `text/csv` attachment `<sheet>-<IST date>.csv`, streamed as `CSV_BOM`, the header, then the pages, each row ending in
 * CRLF. Nothing is stored server-side. Sends the reply: the route returns `reply` after awaiting this.
 */
export async function runCsvExport<C>(app: TxApp, reply: FastifyReply, spec: CsvExportSpec<C>): Promise<void> {
  const cap = spec.cap ?? EXPORT_ROW_CAP;
  const pageSize = spec.pageSize ?? EXPORT_PAGE_SIZE;
  // The snapshot: the count and every page cover rows created up to it, so a row created mid-export can't take the place
  // of the oldest qualifying row. A row whose status (or another filtered field) changes mid-export can still enter or
  // leave the pages, and so can one from a transaction that began before the snapshot and commits after the count
  // (its `created_at` is that transaction's start); never more rows than the count.
  const { rows: snap } = await app.db.execute<{ as_of: string }>(sql`SELECT to_json(now())#>>'{}' AS as_of`);
  const asOf = snap[0]!.as_of;
  const total = await spec.count(asOf);
  if (total > cap) {
    throw new ValidationError(
      `This export has ${total} rows; the most is ${cap}. Narrow the filters and try again.`,
      { total, cap },
      'EXPORT_TOO_LARGE',
    );
  }

  await app.db.transaction((tx) =>
    writeAudit(tx, {
      adminId: spec.adminId,
      action: 'export.create',
      entityType: 'export',
      entityId: spec.sheet,
      before: null,
      after: { filters: maskFilterValues(spec.filters), rowCount: total, includeContacts: spec.includeContacts === true },
    }),
  );

  // Never more rows than the audited count (≤ cap): rows that enter the filter between the count and the last page are
  // left out.
  async function* lines(): AsyncGenerator<string> {
    yield `${CSV_BOM}${csvRow(spec.header)}\r\n`;
    let after: C | null = null;
    let left = total;
    while (left > 0) {
      const { rows, next } = await spec.page(after, { asOf, pageSize });
      const take = rows.slice(0, left);
      left -= take.length;
      if (take.length > 0) yield take.map((r) => `${csvRow(r)}\r\n`).join('');
      if (next === null) return;
      after = next;
    }
  }

  const stream = Readable.from(lines());
  stream.on('error', (err) => app.log.error({ err, sheet: spec.sheet }, 'export stream failed'));
  reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${spec.sheet}-${istToday()}.csv"`)
    .send(stream);
}
