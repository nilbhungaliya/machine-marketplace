import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { EXPORT_ROW_CAP, type ExportSheet } from '@mpm/shared-types';
import { CSV_BOM, csvRow, type CsvCell } from '../../lib/csv.js';
import { ValidationError } from '../../lib/errors.js';
import { istToday } from '../../lib/ist.js';
import { maskContact } from '../../lib/mask-contact.js';
import type { TxApp } from '../../lib/tx-effects.js';
import { writeAudit } from '../audit.service.js';

/**
 * One export (admin close-out §10, R12, plan D10). `count` and `page` run the list's own `WHERE` builder; `page` takes
 * the keyset cursor it returned last (null first) and returns up to `EXPORT_PAGE_SIZE` rows already formatted as cells
 * (`format.ts`), with `next` null on the last page.
 */
export interface CsvExportSpec<C> {
  adminId: string;
  sheet: ExportSheet | 'audit_log';
  /** The list filters as parsed (no page / pageSize); string values reach the audit row only through `maskContact`. */
  filters: Record<string, unknown>;
  includeContacts?: boolean;
  header: string[];
  count(): Promise<number>;
  page(after: C | null): Promise<{ rows: CsvCell[][]; next: C | null }>;
  /** Defaults to `EXPORT_ROW_CAP`; a test passes a small one. */
  cap?: number;
}

/** Filter values as the audit row keeps them: every string (in arrays and objects too) through `maskContact`. */
export function maskFilterValues(value: unknown): unknown {
  if (typeof value === 'string') return maskContact(value);
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
  const total = await spec.count();
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

  // Never more rows than the audited count (≤ cap): rows that appear between the count and the last page are left out.
  async function* lines(): AsyncGenerator<string> {
    yield `${CSV_BOM}${csvRow(spec.header)}\r\n`;
    let after: C | null = null;
    let left = total;
    while (left > 0) {
      const { rows, next } = await spec.page(after);
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
