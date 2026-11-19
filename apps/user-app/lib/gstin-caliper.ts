// The GSTIN caliper's reading (onboarding motion mockup, screen "06 GST"): what the drawing above the GSTIN field shows
// for the text typed so far. Pure, so the segmentation and the per-part checks are tested without React.
import { isValidGstin, normalizeGstin } from './gstin';

export const GSTIN_LENGTH = 15;

export type GstinPartName = 'state' | 'pan' | 'entity' | 'fixed' | 'check';

export interface GstinPart {
  name: GstinPartName;
  /** First character index (inclusive). */
  start: number;
  /** Last character index (exclusive). */
  end: number;
  /** The part's format (the same rules as the shared GSTIN format). */
  format: RegExp;
}

/** The five parts of a GSTIN, in order: state code, PAN, entity number, the fixed `Z`, check character. */
export const GSTIN_PARTS: readonly GstinPart[] = [
  { name: 'state', start: 0, end: 2, format: /^[0-9]{2}$/ },
  { name: 'pan', start: 2, end: 12, format: /^[A-Z]{5}[0-9]{4}[A-Z]$/ },
  // The entity number is 1–9 or A–Z (never 0), as in the shared format.
  { name: 'entity', start: 12, end: 13, format: /^[1-9A-Z]$/ },
  { name: 'fixed', start: 13, end: 14, format: /^Z$/ },
  { name: 'check', start: 14, end: 15, format: /^[0-9A-Z]$/ },
];

/**
 * One character cell: `empty` (nothing typed yet), `meas` (inside the part being measured, not yet complete),
 * `ok` (its part is complete and well formed), `bad` (the check character of a full-length GSTIN that fails the
 * checksum, or of one that runs past 15), `plain` (typed, but its part is complete and malformed).
 */
export type CaliperCellState = 'empty' | 'meas' | 'ok' | 'bad' | 'plain';

export interface CaliperCell {
  char: string;
  state: CaliperCellState;
}

export interface CaliperReading {
  /** The normalized text (may run past 15). */
  gstin: string;
  /** Number of normalized characters typed (may exceed 15). */
  count: number;
  /** Always 15 cells. */
  cells: CaliperCell[];
  /** The part the last typed character is in; null when nothing is typed. */
  part: GstinPartName | null;
  /** Jaw positions in character cells: jaw A at `jaws[0]`, jaw B at `jaws[1]` (0–15). */
  jaws: readonly [number, number];
  /** All 15 characters in and the GSTIN passes `isValidGstin`: "within tolerance". */
  valid: boolean;
  /** The typed characters grouped by part, for the readout (`24 AAKFS4821M 1 Z 6`). */
  groups: string;
}

function partAt(index: number): GstinPart {
  return GSTIN_PARTS.find((p) => index >= p.start && index < p.end) ?? GSTIN_PARTS[GSTIN_PARTS.length - 1];
}

/** Reads the raw field text the way the lookup does (`normalizeGstin`: upper case, spaces removed). */
export function readCaliper(raw: string): CaliperReading {
  const gstin = normalizeGstin(raw);
  const count = gstin.length;
  const shown = gstin.slice(0, GSTIN_LENGTH);
  const valid = count === GSTIN_LENGTH && isValidGstin(gstin);
  const current = count > 0 ? partAt(Math.min(count, GSTIN_LENGTH) - 1) : null;

  const cells: CaliperCell[] = Array.from({ length: GSTIN_LENGTH }, (_, i) => ({ char: shown.charAt(i), state: 'empty' as CaliperCellState }));
  const complete = new Set<GstinPartName>();
  for (const p of GSTIN_PARTS) {
    const typed = shown.slice(p.start, p.end);
    const done = typed.length === p.end - p.start;
    const wellFormed = done && p.format.test(typed);
    if (wellFormed) complete.add(p.name);
    for (let i = p.start; i < p.end; i++) {
      if (!done) cells[i].state = current?.name === p.name ? 'meas' : i < shown.length ? 'plain' : 'empty';
      else cells[i].state = wellFormed ? 'ok' : 'plain';
    }
  }
  // Every part well formed and still not valid is a checksum failure; past 15 characters is out of tolerance too.
  if (count > GSTIN_LENGTH || (count === GSTIN_LENGTH && !valid && complete.size === GSTIN_PARTS.length)) {
    cells[GSTIN_LENGTH - 1].state = 'bad';
  }

  const jaws: readonly [number, number] = valid ? [0, GSTIN_LENGTH] : current ? [current.start, current.end] : [0, 0];
  const groups = GSTIN_PARTS.map((p) => shown.slice(p.start, p.end)).filter(Boolean).join(' ');

  return { gstin, count, cells, part: current?.name ?? null, jaws, valid, groups };
}
