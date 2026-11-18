/**
 * Reads the India Post pincode directory (infra/seed/README.md). Pure: no database, no file access. The file has
 * known defects (swapped and unusable coordinates, inconsistent case), which are cleaned here and in `fillOfficePoints`.
 */

export interface OfficeRow {
  pincode: string;
  officeName: string;
  district: string;
  state: string;
  lat: number | null;
  lng: number | null;
}

/** RFC 4180: quoted fields, doubled quotes, embedded commas and line breaks. A blank line yields no row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endRow = () => {
    // A line with no separator and no text is blank.
    if (row.length > 0 || field !== '') {
      row.push(field);
      rows.push(row);
    }
    row = [];
    field = '';
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') endRow();
    else if (c !== '\r') field += c;
  }
  endRow();
  return rows;
}

/** Trims, collapses spaces and writes Title Case, also after `(`, `-`, `&` and `.`: `KAIMUR (BHABUA)` → `Kaimur (Bhabua)`. */
export function normalizeLocationName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s(\-&.])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase());
}

// B.O, S.O, H.O, P.O, G.P.O with dots and case optional, only after whitespace (so `Sopo` and `Abhiya bazarBO` stay).
const OFFICE_SUFFIX = /\s+(?:[bshp]\.?\s?o|g\.?\s?p\.?\s?o)\.?$/i;

/** Strips the office-type suffix: `Pandesara S.O` → `Pandesara`. */
export function cleanOfficeName(s: string): string {
  return s.trim().replace(OFFICE_SUFFIX, '');
}

const inIndia = (lat: number, lng: number) => lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;

function coordinate(value: string): number | null {
  const trimmed = value.trim().replace(/-$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** `NA` or unparsable → null; a trailing `-` is dropped; a swapped pair is swapped back; outside lat 6–38, lng 68–98 → null. */
export function cleanPoint(lat: string, lng: string): { lat: number; lng: number } | null {
  const a = coordinate(lat);
  const b = coordinate(lng);
  if (a === null || b === null) return null;
  if (inIndia(a, b)) return { lat: a, lng: b };
  if (inIndia(b, a)) return { lat: b, lng: a };
  return null;
}

const PINCODE = /^[1-9]\d{5}$/;
const COLUMNS = ['OfficeName', 'Pincode', 'District', 'StateName', 'Latitude', 'Longitude'] as const;

/** All-caps names get Title Case; a mixed one keeps its case, which keeps acronyms (`Kathwada GIDC`). */
function officeNameOf(raw: string): string {
  const name = cleanOfficeName(raw);
  return name === name.toUpperCase() ? normalizeLocationName(name) : name.replace(/\s+/g, ' ');
}

/**
 * The directory's rows, cleaned and deduped on (pincode, office, district, state). Columns are found by name: a missing
 * one throws, naming it, and so does a row with a bad pincode or no name, naming its line: a refresh must look at it.
 */
export function parseDirectory(csv: string): OfficeRow[] {
  const [header, ...rows] = parseCsv(csv.replace(/^﻿/, ''));
  const names = (header ?? []).map((name) => name.trim());
  const indexOf = (column: (typeof COLUMNS)[number]): number => {
    const index = names.indexOf(column);
    if (index === -1) throw new Error(`Pincode directory: column "${column}" is missing`);
    return index;
  };
  const col = {
    office: indexOf('OfficeName'),
    pincode: indexOf('Pincode'),
    district: indexOf('District'),
    state: indexOf('StateName'),
    lat: indexOf('Latitude'),
    lng: indexOf('Longitude'),
  };

  const seen = new Set<string>();
  const out: OfficeRow[] = [];
  rows.forEach((row, i) => {
    const pincode = (row[col.pincode] ?? '').trim();
    const officeName = officeNameOf(row[col.office] ?? '');
    const district = normalizeLocationName(row[col.district] ?? '');
    const state = normalizeLocationName(row[col.state] ?? '');
    // Line numbers count the header, and assume no quoted line breaks (the file has none).
    if (!PINCODE.test(pincode)) throw new Error(`Pincode directory: line ${i + 2} has the bad pincode "${pincode}"`);
    if (!officeName || !district || !state) throw new Error(`Pincode directory: line ${i + 2} has an empty office, district or state`);

    const key = [pincode, officeName, district, state].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const point = cleanPoint(row[col.lat] ?? '', row[col.lng] ?? '');
    out.push({ pincode, officeName, district, state, lat: point?.lat ?? null, lng: point?.lng ?? null });
  });
  return out;
}
