import { describe, expect, it } from 'vitest';
import type { GstStateView } from '@mpm/shared-types';
import {
  GST_ERROR_KEYS,
  blocksNewAttempt,
  addFilesRoom,
  completionSegments,
  constitutionKey,
  documentProblem,
  gstChip,
  gstScreen,
  newFilesProblem,
  prepareLookup,
  profileRowTarget,
  reviewFromCode,
  secondsUntil,
  startAgain,
  startNotice,
} from './gst-flow';
import { isValidGstin, normalizeGstin } from './gstin';

const view = (patch: Partial<GstStateView>): GstStateView => ({
  mode: 'stub', state: 'none', instantAllowed: true, storageAvailable: true, ...patch,
});

describe('gstScreen: which screen a GST state opens', () => {
  it('none → GSTIN entry', () => {
    expect(gstScreen(view({}))).toEqual({ screen: 'GstStart' });
  });

  it('found → the found card, code_sent → the code screen', () => {
    expect(gstScreen(view({ state: 'found', checkId: 'c1' }))).toEqual({ screen: 'GstFound' });
    expect(gstScreen(view({ state: 'code_sent', checkId: 'c1', proofId: 'p1' }))).toEqual({ screen: 'GstCode' });
  });

  it.each(['under_review', 'needs_more', 'rejected', 'verified', 'revoked'] as const)('%s → the status screen', (state) => {
    expect(gstScreen(view({ state }))).toEqual({ screen: 'GstStatus' });
    expect(gstScreen(view({ state, instantAllowed: false, mode: 'review' }))).toEqual({ screen: 'GstStatus' });
  });

  it('instantAllowed false overrides none (and a stale found / code_sent) with the review form', () => {
    expect(gstScreen(view({ instantAllowed: false, mode: 'review' }))).toEqual({ screen: 'GstReviewForm' });
    expect(gstScreen(view({ state: 'found', instantAllowed: false, gstin: '24AAACC0000C1ZY' }))).toEqual({
      screen: 'GstReviewForm', params: { gstin: '24AAACC0000C1ZY' },
    });
    expect(gstScreen(view({ state: 'code_sent', instantAllowed: false }))).toEqual({ screen: 'GstReviewForm' });
  });

  it('an expired lookup goes back to GSTIN entry with the expired notice', () => {
    const expired = view({ expired: true, gstin: '24AAACC0000C1ZY' });
    expect(gstScreen(expired)).toEqual({ screen: 'GstStart' });
    expect(startNotice(expired)).toBe('expired');
  });
});

describe('blocksNewAttempt: states where GSTIN entry and the review form step aside', () => {
  it('an open review or a verified GSTIN blocks a new lookup or review', () => {
    for (const state of ['under_review', 'needs_more', 'verified'] as const) expect(blocksNewAttempt(state)).toBe(true);
  });

  it('a rejection or revocation does not: those screens are how the user starts again', () => {
    for (const state of ['none', 'found', 'code_sent', 'rejected', 'revoked'] as const) expect(blocksNewAttempt(state)).toBe(false);
  });
});

describe('GST_ERROR_KEYS', () => {
  it('a missing upload asks to upload again; another GSTIN on the business has its own message', () => {
    expect(GST_ERROR_KEYS.DOCUMENT_MISSING).toBe('verification.errors.uploadFailed');
    expect(GST_ERROR_KEYS.GST_OTHER_GSTIN_HELD).toBe('verification.errors.otherGstinHeld');
  });
});

describe('startNotice: the latest lookup outcome on the GSTIN entry screen', () => {
  it('names each outcome, and nothing for a fresh start or another state', () => {
    expect(startNotice(view({}))).toBeNull();
    expect(startNotice(view({ held: true }))).toBe('held');
    expect(startNotice(view({ notFound: true }))).toBe('notFound');
    expect(startNotice(view({ statusRefused: 'cancelled' }))).toBe('statusRefused');
    expect(startNotice(view({ providerUnavailable: true }))).toBe('providerUnavailable');
    expect(startNotice(view({ state: 'rejected', expired: true }))).toBeNull();
  });
});

describe('the review form', () => {
  it('"Can\'t get the code?" passes the lookup and GSTIN to the review form', () => {
    expect(reviewFromCode(view({ state: 'code_sent', checkId: 'c1', proofId: 'p1', gstin: '24AAACC0000C1ZY' }))).toEqual({
      screen: 'GstReviewForm', params: { checkId: 'c1', gstin: '24AAACC0000C1ZY' },
    });
  });

  it('Start again after a rejection opens the instant path only when it is allowed', () => {
    expect(startAgain(view({ state: 'rejected' }))).toEqual({ screen: 'GstStart' });
    expect(startAgain(view({ state: 'rejected', instantAllowed: false }))).toEqual({ screen: 'GstReviewForm' });
    expect(startAgain(view({ state: 'revoked', instantAllowed: false, gstin: '24AAACC0000C1ZY' }))).toEqual({
      screen: 'GstReviewForm', params: { gstin: '24AAACC0000C1ZY' },
    });
  });
});

describe('prepareLookup: the GSTIN is checked in the app before any lookup', () => {
  it('normalises spaces and case, then checks format and checksum', () => {
    expect(prepareLookup(' 24aaacc 0000c1zy ')).toEqual({ ok: true, gstin: '24AAACC0000C1ZY' });
    expect(prepareLookup('')).toEqual({ ok: false, error: 'empty' });
    expect(prepareLookup('24AAACC0000C1ZZ')).toEqual({ ok: false, error: 'invalid' });
    expect(prepareLookup('24AAACC0000C1Z')).toEqual({ ok: false, error: 'invalid' });
  });

  it('uses the shared helpers', () => {
    expect(normalizeGstin('27aapfu 0939f1zv')).toBe('27AAPFU0939F1ZV');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false);
  });
});

describe('secondsUntil: the resend countdown', () => {
  const now = Date.parse('2026-11-18T10:00:00.000Z');
  it('counts whole seconds up, never below zero', () => {
    expect(secondsUntil('2026-11-18T10:00:30.000Z', now)).toBe(30);
    expect(secondsUntil('2026-11-18T10:00:00.400Z', now)).toBe(1);
    expect(secondsUntil('2026-11-18T09:59:00.000Z', now)).toBe(0);
    expect(secondsUntil(undefined, now)).toBe(0);
    expect(secondsUntil('not a date', now)).toBe(0);
  });
});

describe('Profile', () => {
  it('the rows open the onboarding screens in edit mode', () => {
    expect(profileRowTarget('location')).toEqual({ screen: 'WhereAreYou', params: { mode: 'edit' } });
    expect(profileRowTarget('business')).toEqual({ screen: 'YourBusiness', params: { mode: 'edit' } });
  });

  it('the GST row opens the screen gst-flow picks', () => {
    expect(profileRowTarget('gst', view({ state: 'verified' }))).toEqual({ screen: 'GstStatus' });
    expect(profileRowTarget('gst', view({ instantAllowed: false }))).toEqual({ screen: 'GstReviewForm' });
    expect(profileRowTarget('gst', null)).toEqual({ screen: 'GstStart' });
  });

  it('the completion meter has four segments, each with the row that completes it', () => {
    expect(completionSegments({ name: true, activities: false, location: true, gst: false })).toEqual([
      { key: 'name', done: true, row: 'business' },
      { key: 'activities', done: false, row: 'business' },
      { key: 'location', done: true, row: 'location' },
      { key: 'gst', done: false, row: 'gst' },
    ]);
  });

  it('the GST chip follows the state', () => {
    expect(gstChip('verified')).toEqual({ key: 'verification.chip.verified', tone: 'green' });
    expect(gstChip('under_review')).toEqual({ key: 'verification.chip.underReview', tone: 'orange' });
    expect(gstChip('needs_more')).toEqual({ key: 'verification.chip.needsMore', tone: 'orange' });
    expect(gstChip('rejected')).toEqual({ key: 'verification.chip.rejected', tone: 'red' });
    expect(gstChip('revoked')).toEqual({ key: 'verification.chip.revoked', tone: 'red' });
    for (const s of ['none', 'found', 'code_sent'] as const) {
      expect(gstChip(s)).toEqual({ key: 'verification.chip.notVerified', tone: 'muted' });
    }
  });
});

describe('documentProblem: the review file rule, before anything is uploaded', () => {
  const pdf = (type: 'gst_certificate' | 'id_proof' | 'authorisation_letter' | null, size = 1000) => ({ type, size, mimeType: 'application/pdf' });

  it('needs a certificate and an ID or letter, 2 to 5 files', () => {
    expect(documentProblem([pdf('gst_certificate'), pdf('id_proof')])).toBeNull();
    expect(documentProblem([pdf('gst_certificate'), pdf('authorisation_letter')])).toBeNull();
    expect(documentProblem([pdf('gst_certificate')])).toBe('count');
    expect(documentProblem([pdf('id_proof'), pdf('id_proof')])).toBe('certificate');
    expect(documentProblem([pdf('gst_certificate'), pdf('gst_certificate')])).toBe('person');
    expect(documentProblem(Array.from({ length: 6 }, () => pdf('gst_certificate')))).toBe('count');
  });

  it('every file needs a type, an allowed format and at most 10 MB', () => {
    expect(documentProblem([pdf('gst_certificate'), pdf(null)])).toBe('untyped');
    expect(documentProblem([pdf('gst_certificate'), { type: 'id_proof', size: 10, mimeType: 'image/gif' }])).toBe('fileType');
    expect(documentProblem([pdf('gst_certificate'), pdf('id_proof', 10_485_761)])).toBe('tooLarge');
    expect(documentProblem([pdf('gst_certificate'), pdf('id_proof', 10_485_760)])).toBeNull();
  });

  it('adding files to a review counts the files it already has', () => {
    expect(documentProblem([pdf('id_proof')], ['gst_certificate'])).toBeNull();
    expect(documentProblem([], ['gst_certificate', 'id_proof'])).toBe('count');
    expect(documentProblem([pdf('id_proof'), pdf('id_proof')], ['gst_certificate', 'id_proof', 'id_proof', 'id_proof'])).toBe('count');
  });
});

describe('newFilesProblem: files added after the officer asks for more', () => {
  // The API's rule (spec §5.3 amendment): 1–5 new files, at most 10 on the review in all. The certificate / ID rule
  // over the whole set is the API's (the state view gives the count, not the types).
  const file = { type: 'id_proof' as const, size: 1000, mimeType: 'image/jpeg' };
  const files = (n: number) => Array.from({ length: n }, () => file);

  it('needs 1 to 5 typed, allowed files of at most 10 MB', () => {
    expect(newFilesProblem([file])).toBeNull();
    expect(newFilesProblem([])).toBe('count');
    expect(newFilesProblem([{ ...file, type: null }])).toBe('untyped');
    expect(newFilesProblem([{ ...file, mimeType: 'text/html' }])).toBe('fileType');
    expect(newFilesProblem([{ ...file, size: 10_485_761 }])).toBe('tooLarge');
    expect(newFilesProblem(files(4))).toBeNull();
    expect(newFilesProblem(files(5))).toBeNull();
    expect(newFilesProblem(files(6))).toBe('count');
  });

  it('a review that already has 4 or 5 files still takes 5 more, up to 10 in all', () => {
    expect(newFilesProblem(files(5), 4)).toBeNull();
    expect(newFilesProblem(files(5), 5)).toBeNull();
    expect(newFilesProblem(files(1), 10)).toBe('total');
    expect(newFilesProblem(files(3), 8)).toBe('total');
    expect(newFilesProblem(files(2), 8)).toBeNull();
  });

  it('room left on a review', () => {
    expect(addFilesRoom(2)).toBe(5);
    expect(addFilesRoom(7)).toBe(3);
    expect(addFilesRoom(10)).toBe(0);
    expect(addFilesRoom(undefined)).toBe(5);
  });
});

describe('constitutionKey: officer-approved details carry a key, a provider sends text', () => {
  it('a shared-types key → its translation key; anything else → null (shown as it came)', () => {
    expect(constitutionKey('private_limited')).toBe('verification.constitution.private_limited');
    expect(constitutionKey('proprietorship')).toBe('verification.constitution.proprietorship');
    expect(constitutionKey('Private Limited Company')).toBeNull();
    expect(constitutionKey('')).toBeNull();
  });
});
