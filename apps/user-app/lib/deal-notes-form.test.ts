import { describe, expect, it } from 'vitest';
import { changedNotesFields, notesFormOf, notesPatchBody, rebaseNotesForm, type NotesSnapshot } from './deal-notes-form';

const notes = (over: Partial<Parameters<typeof notesFormOf>[0]> = {}) => notesFormOf({
  paymentMethod: 'upi', advancePaise: '2000000', fulfilment: 'pickup', expectedOn: '2026-11-21', text: 'Gate 2', ...over,
});

describe('deal notes editor (§9.1)', () => {
  const base: NotesSnapshot = { version: 3, form: notes() };

  it('sends only the fields changed against the snapshot, with its version', () => {
    expect(notesPatchBody({ ...base.form, text: ' Gate 2 ' }, base)).toBeNull();
    expect(changedNotesFields({ ...base.form, advance: '25000' }, base.form)).toEqual(['advance']);
    expect(notesPatchBody({ ...base.form, advance: '25000.50', expectedOn: '' }, base))
      .toEqual({ version: 3, advancePaise: '2500050', expectedOn: null });
    expect(notesPatchBody({ ...base.form, paymentMethod: null, text: '  ' }, base))
      .toEqual({ version: 3, paymentMethod: null, text: null });
  });

  it('DEAL_STALE: untouched fields take the fresh values, edited fields stay, the snapshot moves on', () => {
    const fresh: NotesSnapshot = { version: 4, form: notes({ paymentMethod: 'bank', text: 'Gate 5', advancePaise: '1000000' }) };
    const mine = { ...base.form, text: 'Call before coming' };
    const out = rebaseNotesForm(mine, base, fresh);
    expect(out.base).toBe(fresh);
    expect(out.form).toEqual({ ...fresh.form, text: 'Call before coming' });
    // The retried save sends only the user's edit, on the new version.
    expect(notesPatchBody(out.form, out.base)).toEqual({ version: 4, text: 'Call before coming' });
  });
});
