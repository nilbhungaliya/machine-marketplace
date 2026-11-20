export type CsvCell = string | number | boolean | null;

/** The UTF-8 byte order mark that starts every CSV file, so Excel reads it as UTF-8. */
export const CSV_BOM = '﻿';

/** Leading characters a spreadsheet may treat as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  if (value === null) return '';
  let text = String(value);
  // Only text is neutralised: numbers (e.g. a min of -5) and booleans stay plain values.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One CSV row with the cell rules of `toCsv`, without a line ending (admin close-out C0-4: a streamed export writes
 * `CSV_BOM` once, then each row followed by CRLF).
 */
export function csvRow(cells: CsvCell[]): string {
  return cells.map(cell).join(',');
}

/**
 * RFC 4180 CSV: fields containing `,` `"` CR or LF are quoted with `"` doubled; null is empty;
 * rows joined with CRLF. Prefixed with a UTF-8 BOM so Excel reads it as UTF-8.
 * Text cells starting with `=` `+` `-` `@` TAB or CR get a leading `'` (CSV formula injection).
 */
export function toCsv(rows: CsvCell[][]): string {
  return CSV_BOM + rows.map(csvRow).join('\r\n');
}
