import { describe, expect, it } from 'vitest';
import type { ReplyOption } from '@mpm/shared-types';
import { cardFixture } from './listing-fixtures.test-helper';
import {
  pickerRows, rejectedListingIds, replyInvalidKey, replyStatusLine, selectionCap, sellerActions, toggleSelection,
} from './reply-picker';

const opt = (id: string, reason: ReplyOption['reason'] = null): ReplyOption => ({
  listingId: id, card: cardFixture({ id }), fit: reason === null, reason,
});

describe('reply picker (F8 §9.2)', () => {
  const options = [opt('side', 'side'), opt('a'), opt('replied', 'replied'), opt('b'), opt('c'), opt('d')];

  it('orders fitting listings first and greys the others with their reason key', () => {
    const rows = pickerRows(options, 3, []);
    expect(rows.map((r) => r.listingId)).toEqual(['a', 'b', 'c', 'd', 'side', 'replied']);
    expect(rows.slice(0, 4).every((r) => !r.disabled && r.reasonKey === null)).toBe(true);
    expect(rows[4]).toMatchObject({ disabled: true, selected: false, reasonKey: 'buyers.reply.reason.side' });
    expect(rows[5]).toMatchObject({ disabled: true, reasonKey: 'buyers.reply.reason.replied' });
  });

  it('caps the selection at three and at the slots left', () => {
    const full = pickerRows(options, 3, ['a', 'b', 'c']);
    expect(full.find((r) => r.listingId === 'd')?.disabled).toBe(true);
    expect(full.find((r) => r.listingId === 'a')).toMatchObject({ selected: true, disabled: false });

    const oneSlot = pickerRows(options, 1, ['a']);
    expect(oneSlot.find((r) => r.listingId === 'b')?.disabled).toBe(true);
    expect(pickerRows(options, 0, []).every((r) => r.disabled)).toBe(true);
  });

  it('refuses a 4th selection, one beyond the slots left and a greyed listing; a tap removes a selected one', () => {
    expect(toggleSelection(['a', 'b', 'c'], 'd', options, selectionCap(3))).toEqual(['a', 'b', 'c']);
    expect(toggleSelection(['a', 'b', 'c'], 'd', options, 10)).toEqual(['a', 'b', 'c']);
    expect(toggleSelection(['a'], 'b', options, selectionCap(1))).toEqual(['a']);
    expect(toggleSelection([], 'side', options, 3)).toEqual([]);
    expect(toggleSelection(['a'], 'b', options, selectionCap(3))).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a', options, 3)).toEqual(['b']);
    expect(selectionCap(3, 1)).toBe(1);
    expect(selectionCap(5)).toBe(3);
  });

  it('maps REPLY_LISTING_INVALID reasons, unknown ones to the generic line', () => {
    expect(replyInvalidKey({ reasons: { x: 'side' } })).toBe('buyers.reply.invalid.side');
    expect(replyInvalidKey({ reasons: { x: 'not_found', y: 'condition' } })).toBe('buyers.reply.invalid.condition');
    expect(replyInvalidKey({ reasons: { x: 'not_live' } })).toBe('buyers.reply.invalid.generic');
    expect(replyInvalidKey({ reasons: { draft: 'kind' } })).toBe('buyers.reply.invalid.kind');
    expect(rejectedListingIds({ reasons: { x: 'not_live', draft: 'kind' } })).toEqual(['x']);
    expect(rejectedListingIds({ listingIds: ['y'] })).toEqual(['y']);
  });

  it('gives each reply status its line', () => {
    expect(replyStatusLine({ status: 'pending', dropReason: null, seenByBuyer: false }).key).toBe('buyers.myReplies.pending');
    expect(replyStatusLine({ status: 'delivered', dropReason: null, seenByBuyer: true }).key).toBe('buyers.myReplies.seen');
    expect(replyStatusLine({ status: 'dropped', dropReason: 'listing_rejected', seenByBuyer: false }).key)
      .toBe('buyers.myReplies.dropped.listing_rejected');
  });

  it('keeps a viewer away from Reply, Not relevant, Withdraw and Report', () => {
    const viewer = sellerActions({ status: 'active', canAct: false, canReply: false, notRelevant: false });
    expect(viewer).toMatchObject({ viewer: true, reply: false, notRelevant: false, undoNotRelevant: false, report: false, withdraw: false });
    expect(viewer.replyBlockedKey).toBe('buyers.request.replyBlocked.viewer');
    // A viewer is told apart on a closed request too.
    expect(sellerActions({ status: 'closed', canAct: false, canReply: false, notRelevant: false }))
      .toMatchObject({ viewer: true, report: false, withdraw: false, replyBlockedKey: 'buyers.request.replyBlocked.closed' });

    const seller = sellerActions({ status: 'active', canAct: true, canReply: true, notRelevant: true });
    expect(seller).toMatchObject({ viewer: false, reply: true, notRelevant: false, undoNotRelevant: true, report: true });

    expect(sellerActions({ status: 'active', canAct: true, canReply: false, notRelevant: false }).replyBlockedKey)
      .toBe('buyers.request.replyBlocked.full');
    expect(sellerActions({ status: 'closed', canAct: true, canReply: false, notRelevant: false }))
      .toMatchObject({ viewer: false, notRelevant: false, replyBlockedKey: 'buyers.request.replyBlocked.closed' });
  });
});
