import { describe, expect, it } from 'vitest';
import { LISTING_STATUSES } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import type { CategoryNode, MyListingCard } from '@mpm/shared-types';
import { cardFixture, ownerFixture } from './listing-fixtures.test-helper';
import {
  MY_LISTINGS_SEGMENTS, actionToastKey, editEntry, editSections, gateStep, isStaleListingError, manageItems, myCardChip,
  myCardNudge, myCardSubtitle, needsConfirm, nodeHasSides, ownerNote, quantityToastKey, showRenew, statusChip, statusGroup,
  wizardStartStep,
} from './my-listings';

const mine = (over: Partial<MyListingCard> = {}): MyListingCard => ({
  ...cardFixture(),
  updatedAt: '2026-11-15T10:00:00.000Z',
  expiresAt: null,
  expiringSoon: false,
  moderation: null,
  statusReason: null,
  scoreMissing: [],
  needsAttention: [],
  rentalLine: null,
  ...over,
});

/** Video upload on (the nudge may ask for a video). */
const nudgeOn = (c: MyListingCard) => myCardNudge(c, { videoEnabled: true });

const apiError = (status: number, code: string, details?: Record<string, unknown>) => ({
  response: { status, data: { error: 'English message', code, details } },
});

describe('statusGroup', () => {
  it('hidden sits under Paused', () => {
    expect(statusGroup('hidden')).toBe('paused');
  });
  it('maps every status to the §10 groups', () => {
    expect(statusGroup('live')).toBe('live');
    expect(statusGroup('reserved')).toBe('live');
    expect(statusGroup('rented')).toBe('live');
    expect(statusGroup('pending_review')).toBe('review');
    expect(statusGroup('rejected')).toBe('review');
    expect(statusGroup('expired')).toBe('paused');
    expect(statusGroup('unavailable')).toBe('paused');
    expect(statusGroup('sold')).toBe('sold');
    expect(statusGroup('draft')).toBe('drafts');
    expect(statusGroup('removed')).toBe('removed_by_team');
  });
  it('segments are the four of the control', () => {
    expect(MY_LISTINGS_SEGMENTS).toEqual(['live', 'review', 'paused', 'sold']);
  });
});

describe('statusChip', () => {
  it('every status has an en label', () => {
    for (const s of LISTING_STATUSES) expect(i18n.exists(statusChip(s).key), s).toBe(true);
  });
  it('tones', () => {
    expect(statusChip('live').tone).toBe('ok');
    expect(statusChip('rejected').tone).toBe('danger');
    expect(statusChip('expired').tone).toBe('warn');
  });
});

describe('manageItems (§10)', () => {
  it('a live left part: edit, quantity, the allowed actions, Find the other side, remove last', () => {
    expect(manageItems({ status: 'live', kind: 'part', side: 'left' })).toEqual([
      'edit', 'quantity', 'pause', 'renew', 'mark_sold', 'mark_unavailable', 'other_side', 'remove',
    ]);
  });
  it('a paused machine: resume; no other side', () => {
    expect(manageItems({ status: 'paused', kind: 'machine', side: null })).toEqual([
      'edit', 'quantity', 'resume', 'mark_sold', 'mark_unavailable', 'remove',
    ]);
  });
  it('a machine for rent: no Mark sold and no rental-only action (M14 §7.1: its bookings set rented)', () => {
    expect(manageItems({ status: 'live', kind: 'machine_rental', side: null })).toEqual([
      'edit', 'quantity', 'pause', 'renew', 'mark_unavailable', 'remove',
    ]);
    const rented = manageItems({ status: 'rented', kind: 'machine_rental', side: null });
    expect(rented).toEqual(expect.arrayContaining(['pause', 'renew', 'mark_unavailable', 'remove']));
    expect(rented).not.toContain('mark_sold');
  });
  it('hidden: only remove (not editable)', () => {
    expect(manageItems({ status: 'hidden', kind: 'part', side: 'right' })).toEqual(['other_side', 'remove']);
  });
  it('View listing when asked for, never on a removed one', () => {
    expect(manageItems({ status: 'sold', kind: 'part', side: 'pair' }, { view: true })).toEqual([
      'edit', 'quantity', 'relist', 'view', 'remove',
    ]);
    expect(manageItems({ status: 'removed', kind: 'part', side: null }, { view: true })).toEqual([]);
  });
  it('no Duplicate (decision 8)', () => {
    expect(manageItems({ status: 'live', kind: 'part', side: null })).not.toContain('duplicate');
  });
});

describe('needsConfirm and the result toast', () => {
  it('Remove and Mark sold confirm', () => {
    expect(needsConfirm('remove')).toBe(true);
    expect(needsConfirm('mark_sold')).toBe(true);
    expect(needsConfirm('pause')).toBe(false);
  });
  it("a go-live action sent to review says so; else the action's line", () => {
    expect(actionToastKey('resume', 'pending_review')).toBe('listing.manage.sentForReview');
    expect(actionToastKey('resume', 'live')).toBe('listing.manage.done.resume');
    for (const a of ['pause', 'resume', 'renew', 'mark_sold', 'mark_unavailable', 'relist', 'remove'] as const) {
      expect(i18n.exists(actionToastKey(a, 'live')), a).toBe(true);
    }
  });
});

describe('gateStep', () => {
  it('a LISTING_INCOMPLETE refusal opens the step of its first fixable problem', () => {
    const err = apiError(400, 'LISTING_INCOMPLETE', { problems: [{ field: 'nope', code: 'x' }, { field: 'specs.width', code: 'required' }] });
    expect(gateStep(err, 'part')).toBe('part_details');
    expect(gateStep(err, 'machine')).toBe('machine');
    expect(gateStep(apiError(400, 'LISTING_INCOMPLETE', { problems: [{ field: 'photos', code: 'required' }] }), 'part')).toBe('media');
  });
  it('anything else → null', () => {
    expect(gateStep(apiError(409, 'UNVERIFIED_LISTING_CAP', { cap: 3 }), 'part')).toBeNull();
  });
});

describe('edit entry and sections (§10, R43)', () => {
  it('draft and rejected start the wizard; editable statuses the menu; others nothing', () => {
    expect(editEntry('rejected')).toBe('wizard');
    expect(editEntry('draft')).toBe('wizard');
    expect(editEntry('live')).toBe('menu');
    expect(editEntry('sold')).toBe('menu');
    expect(editEntry('hidden')).toBeNull();
    // F6 + F7 §8.3: reserved is editable (quantity ≥ held).
    expect(editEntry('reserved')).toBe('menu');
  });
  it('no Category on a published listing; side when the node has sides', () => {
    const l = { kind: 'part' as const, status: 'live' as const, side: 'left' as const, needsAttention: [] };
    expect(editSections(l, true).map((x) => x.step)).toEqual(['part_details', 'quantity', 'fit', 'side', 'media', 'price', 'location']);
    expect(editSections(l, false).map((x) => x.step)).not.toContain('side');
  });
  it('unknown node: side when the listing has one or a nudge asks for one', () => {
    const base = { kind: 'part' as const, status: 'live' as const, needsAttention: [] };
    expect(editSections({ ...base, side: 'left' }, null).map((x) => x.step)).toContain('side');
    expect(editSections({ ...base, side: 'not_applicable' }, null).map((x) => x.step)).not.toContain('side');
    expect(editSections({ ...base, side: 'not_applicable', needsAttention: [{ field: 'side', code: 'SIDE_REQUIRED' }] }, null)
      .find((x) => x.step === 'side')?.attention).toBe(true);
  });
  it('marks the sections a nudge points at', () => {
    const l = { kind: 'machine' as const, status: 'paused' as const, side: null, needsAttention: [{ field: 'specs.power', code: 'required' }] };
    expect(editSections(l, false).filter((x) => x.attention).map((x) => x.step)).toEqual(['machine']);
  });
});

describe('nodeHasSides', () => {
  const node = (id: string, effectiveHasSides: boolean, children: CategoryNode[] = []): CategoryNode => ({
    id, parentId: null, level: 'part_group' as CategoryNode['level'], name: id, slug: id, path: id, icon: null, sortOrder: 0,
    isActive: true, hasSides: null, sideConvention: null, effectiveHasSides, effectiveSideConvention: '', children,
  });
  it('finds the node anywhere in the tree', () => {
    const tree = [node('a', false, [node('b', false, [node('c', true)])])];
    expect(nodeHasSides(tree, 'c')).toBe(true);
    expect(nodeHasSides(tree, 'b')).toBe(false);
    expect(nodeHasSides(tree, 'x')).toBeNull();
    expect(nodeHasSides(undefined, 'c')).toBeNull();
    expect(nodeHasSides(tree, null)).toBeNull();
  });
});

describe('My listings cards', () => {
  const now = Date.parse('2026-11-18T10:00:00.000Z');
  it('expiring soon: the warn chip, "Expires in n days" and the Renew banner', () => {
    const c = mine({ expiringSoon: true, expiresAt: '2026-11-23T12:00:00.000Z' });
    expect(myCardChip(c)).toEqual({ key: 'listing.mine.expiringSoon', tone: 'warn' });
    expect(myCardSubtitle(c, now)).toBe('Expires in 5 days');
    expect(showRenew(c)).toBe(true);
    expect(i18n.exists(myCardChip(c).key)).toBe(true);
  });
  it('otherwise the status chip and "Updated n days ago"', () => {
    const c = mine();
    expect(myCardChip(c)).toEqual(statusChip('live'));
    expect(myCardSubtitle(c, now)).toBe('Updated 3 days ago');
    expect(showRenew(c)).toBe(false);
  });
  it("the moderator's message on a rejected listing", () => {
    const n = nudgeOn(mine({ status: 'rejected', moderation: { outcome: 'changes_requested', note: 'Add a real photo', at: '' } }));
    expect(n).toEqual({ key: 'listing.mine.moderatorSays', values: { note: 'Add a real photo' } });
  });
  it('a hide reason, then needs attention, then the first score nudge', () => {
    expect(nudgeOn(mine({ status: 'hidden', statusReason: 'Stock photo' }))).toEqual({ key: 'listing.mine.hiddenReason', values: { reason: 'Stock photo' } });
    expect(nudgeOn(mine({ needsAttention: [{ field: 'side', code: 'SIDE_REQUIRED' }], scoreMissing: ['video'] }))?.key).toBe('listing.mine.needsAttention');
    expect(nudgeOn(mine({ scoreMissing: ['video', 'description'] }))?.key).toBe('listing.score.video');
    expect(nudgeOn(mine())).toBeNull();
  });
  it('no score nudge on sold listings; in review says so', () => {
    expect(nudgeOn(mine({ status: 'sold', scoreMissing: ['video'] }))).toBeNull();
    expect(nudgeOn(mine({ status: 'pending_review', scoreMissing: ['video'] }))?.key).toBe('listing.mine.inReview');
  });
  it('every nudge key exists in en', () => {
    for (const k of ['listing.mine.moderatorSays', 'listing.mine.hiddenReason', 'listing.mine.needsAttention', 'listing.mine.inReview', 'listing.mine.changesRequested']) {
      expect(i18n.exists(k), k).toBe(true);
    }
  });
});

describe('review fixes (L6 review)', () => {
  it('no "Add a video" nudge while video upload is off', () => {
    const c = mine({ scoreMissing: ['video', 'description'] });
    expect(myCardNudge(c, { videoEnabled: false })?.key).toBe('listing.score.description');
    expect(myCardNudge(mine({ scoreMissing: ['video'] }), { videoEnabled: false })).toBeNull();
    expect(myCardNudge(c, { videoEnabled: true })?.key).toBe('listing.score.video');
  });
  it('a draft offers Edit and Delete draft, not Update quantity', () => {
    expect(manageItems({ status: 'draft', kind: 'part', side: 'left' })).toEqual(['edit', 'delete_draft']);
    expect(manageItems({ status: 'draft', kind: 'machine', side: null }, { view: true })).toEqual(['edit', 'view', 'delete_draft']);
    expect(needsConfirm('delete_draft')).toBe(true);
    expect(actionToastKey('delete_draft', 'draft')).toBe('listing.manage.done.delete_draft');
    expect(i18n.exists('listing.manage.done.delete_draft')).toBe(true);
    expect(i18n.exists('listing.manage.delete_draft')).toBe(true);
  });
  it('the wizard starts a draft at its first incomplete step, a rejected listing at the category', () => {
    const draft = ownerFixture({ categoryId: 'c1', title: 'Bracket' });
    expect(wizardStartStep(draft, true)).toBe('quantity');
    expect(wizardStartStep(ownerFixture({ status: 'rejected', categoryId: 'c1', title: 'Bracket' }), true)).toBe('category');
  });
  it('stale-listing errors refresh the lists', () => {
    const err = (status: number, code: string) => ({ response: { status, data: { code } } });
    expect(isStaleListingError(err(409, 'LISTING_TRANSITION_NOT_ALLOWED'))).toBe(true);
    expect(isStaleListingError(err(409, 'LISTING_NOT_EDITABLE'))).toBe(true);
    expect(isStaleListingError(err(404, 'LISTING_NOT_FOUND'))).toBe(true);
    expect(isStaleListingError(err(409, 'UNVERIFIED_LISTING_CAP'))).toBe(false);
    expect(isStaleListingError({ code: 'ERR_NETWORK' })).toBe(false);
  });
  it('a quantity edit that sent a public listing back to review says so', () => {
    expect(quantityToastKey('live', 'pending_review')).toBe('listing.manage.sentForReview');
    expect(quantityToastKey('rented', 'pending_review')).toBe('listing.manage.sentForReview');
    expect(quantityToastKey('pending_review', 'pending_review')).toBe('listing.quantitySheet.saved');
    expect(quantityToastKey('live', 'live')).toBe('listing.quantitySheet.saved');
  });
  it("the owner's note on the listing page: the moderator's message or the hide reason only", () => {
    const view = (over: Parameters<typeof ownerFixture>[0]) => ownerFixture(over);
    expect(ownerNote(view({ status: 'rejected', moderation: { outcome: 'rejected', note: 'Blurry', at: '' } }))).toEqual({
      key: 'listing.mine.moderatorSays', values: { note: 'Blurry' },
    });
    expect(ownerNote(view({ status: 'hidden', statusReason: 'Stock photo' }))?.key).toBe('listing.mine.hiddenReason');
    expect(ownerNote(view({ status: 'live', score: { score: 20, missing: ['video'] } }))).toBeNull();
  });
});
