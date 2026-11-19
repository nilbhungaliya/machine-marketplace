import type { DealFulfilment, DealNotes, DealPaymentMethod } from '@mpm/shared-types';
import { dayInputText, parseDayInput, rupeesInputText } from './deal-display';
import type { DealNotesPatch } from './deals-api';
import { parseRupees } from './money';

// The Deal record's notes editor (F6 + F7 spec §9.1): one shared record, last write wins with `version`. The sheet
// snapshots the notes it opened on ({ version, form }), sends only the fields changed against that snapshot, and on
// `409 DEAL_STALE` rebases onto the fresh record: fields the user didn't touch take the new server values, edited
// fields stay. Pure.

export interface NotesForm {
  paymentMethod: DealPaymentMethod | null;
  /** Rupees as typed. */
  advance: string;
  fulfilment: DealFulfilment | null;
  /** DD-MM-YYYY as typed. */
  expectedOn: string;
  text: string;
}

export interface NotesSnapshot {
  version: number;
  form: NotesForm;
}

export const NOTES_FIELDS = ['paymentMethod', 'advance', 'fulfilment', 'expectedOn', 'text'] as const;
export type NotesField = (typeof NOTES_FIELDS)[number];

/** The form a deal's notes open as. */
export function notesFormOf(notes: Pick<DealNotes, 'paymentMethod' | 'advancePaise' | 'fulfilment' | 'expectedOn' | 'text'>): NotesForm {
  return {
    paymentMethod: notes.paymentMethod,
    advance: rupeesInputText(notes.advancePaise),
    fulfilment: notes.fulfilment,
    expectedOn: dayInputText(notes.expectedOn),
    text: notes.text ?? '',
  };
}

const same = (a: NotesForm, b: NotesForm, f: NotesField): boolean => {
  const x = a[f];
  const y = b[f];
  return typeof x === 'string' && typeof y === 'string' ? x.trim() === y.trim() : x === y;
};

/** The fields the user changed against the snapshot (typed spaces don't count). */
export function changedNotesFields(form: NotesForm, base: NotesForm): NotesField[] {
  return NOTES_FIELDS.filter((f) => !same(form, base, f));
}

/**
 * After `DEAL_STALE`: the user's edits on top of the fresh record. Every field the user didn't change takes the new
 * value; each changed field keeps the user's text. The snapshot moves to the fresh version.
 */
export function rebaseNotesForm(form: NotesForm, base: NotesSnapshot, fresh: NotesSnapshot): { form: NotesForm; base: NotesSnapshot } {
  const changed = new Set(changedNotesFields(form, base.form));
  const next = { ...fresh.form };
  for (const f of changed) (next as Record<NotesField, unknown>)[f] = form[f];
  return { form: next, base: fresh };
}

/**
 * The `PATCH /deals/:id/notes` body for the changed fields, with the snapshot's version; null when nothing changed.
 * Call only on a valid form (advance and date already checked).
 */
export function notesPatchBody(form: NotesForm, base: NotesSnapshot): DealNotesPatch | null {
  const changed = changedNotesFields(form, base.form);
  if (changed.length === 0) return null;
  const body: DealNotesPatch = { version: base.version };
  for (const f of changed) {
    switch (f) {
      case 'paymentMethod': body.paymentMethod = form.paymentMethod; break;
      case 'fulfilment': body.fulfilment = form.fulfilment; break;
      case 'advance': {
        const paise = form.advance.trim() === '' ? null : parseRupees(form.advance);
        body.advancePaise = paise == null ? null : String(paise);
        break;
      }
      case 'expectedOn': {
        const day = parseDayInput(form.expectedOn);
        body.expectedOn = day ? day : null;
        break;
      }
      case 'text': {
        const text = form.text.trim();
        body.text = text === '' ? null : text;
        break;
      }
    }
  }
  return body;
}
