import { describe, expect, it } from 'vitest';
import { SYSTEM_LINE_CODES, type InboxPage, type InboxRow, type ThreadMessage } from '@mpm/shared-types';
import en from '../locales/en/chats.json';
import hi from '../locales/hi/chats.json';
import gu from '../locales/gu/chats.json';
import {
  addMessageToPages, applyInboxRow, pillFor, previewFor, systemLineParams, yourTurnDelta, type Translate,
} from './chat-format';

const t: Translate = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  threadId: 't1',
  side: 'buyer',
  counterpart: { businessId: 'b2', name: 'Om Agro', gstVerified: true },
  listing: { listingId: 'l1', kind: 'part', title: 'Cylinder', thumbUrl: null },
  lastMessage: null,
  unread: 0,
  yourTurn: false,
  enquiryStatus: 'open',
  pill: 'open',
  archived: false,
  ...over,
});

const last = (over: Partial<NonNullable<InboxRow['lastMessage']>>): Pick<InboxRow, 'lastMessage'> => ({
  lastMessage: { kind: 'text', text: null, photoCount: 0, systemCode: null, offer: null, isMine: false, at: '2026-11-19T10:00:00Z', ...over },
});

const msg = (seq: number, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: `m${seq}`,
  threadId: 't1',
  seq: String(seq),
  kind: 'text',
  senderSide: 'buyer',
  isMine: false,
  clientMessageId: null,
  text: 'x',
  photos: [],
  scamWarning: false,
  system: null,
  enquiry: null,
  offer: null,
  deal: null,
  createdAt: '2026-11-19T10:00:00Z',
  ...over,
});

const ids = (pages: ThreadMessage[][]) => pages.map((p) => p.map((m) => m.seq));

describe('previewFor', () => {
  it('shows each kind: text as sent, photo count, offer price per unit, system code, mine prefixed', () => {
    expect(previewFor(last({ text: 'Is it available? ••••••••••' }), t)).toBe('Is it available? ••••••••••');
    expect(previewFor(last({ kind: 'photos', photoCount: 2 }), t)).toBe('chats.preview.photos {"count":2}');
    expect(previewFor(last({ kind: 'offer', offer: { pricePerUnitPaise: 3_400_000, unitLabel: 'pc' } }), t)).toBe(
      'chats.preview.offerPerUnit {"price":"₹34,000","unit":"pc"}',
    );
    expect(previewFor(last({ kind: 'system', systemCode: 'deal_agreed' }), t)).toBe('chats.systemPreview.deal_agreed');
    expect(previewFor(last({ kind: 'text', text: 'Hi', isMine: true }), t)).toBe('chats.preview.mine {"text":"Hi"}');
    expect(previewFor({ lastMessage: null }, t)).toBe('chats.preview.none');
  });
});

describe('pillFor', () => {
  it('Your turn beats Deal beats the enquiry status', () => {
    expect(pillFor({ yourTurn: true, pill: 'deal', enquiryStatus: 'converted' })).toBe('your_turn');
    expect(pillFor({ yourTurn: false, pill: 'deal', enquiryStatus: 'converted' })).toBe('deal');
    expect(pillFor({ yourTurn: false, pill: 'your_turn', enquiryStatus: 'replied' })).toBe('replied');
  });
});

describe('systemLineParams', () => {
  const resolve = (tree: unknown, key: string): unknown =>
    key.split('.').slice(1).reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);

  it('every code gives a key (and its reason / category / field keys) present in en, hi and gu, both sides', () => {
    for (const code of SYSTEM_LINE_CODES) {
      for (const by of ['buyer', 'seller', 'both', 'system']) {
        const copy = systemLineParams(
          code,
          { by, side: by, reason: 'listing_unavailable', category: 'damaged', outcome: 'completed', fields: 'advance,text', ref: 500001 },
          { mySide: 'buyer', counterpartName: 'Om Agro' },
        );
        const keys = [copy.key, ...Object.values(copy.keyParams).flat()];
        for (const key of keys) {
          for (const [lang, tree] of [['en', en], ['hi', hi], ['gu', gu]] as const) {
            expect(typeof resolve(tree, key), `${lang} ${key}`).toBe('string');
          }
        }
      }
    }
  });

  it('a side becomes "mine" or "theirs" for the reader; unknown codes fall back safely', () => {
    const ctx = { mySide: 'seller' as const, counterpartName: 'Om Agro' };
    expect(systemLineParams('offer_rejected', { side: 'seller' }, ctx).key).toBe('chats.system.offer_rejected.mine');
    expect(systemLineParams('offer_rejected', { side: 'buyer' }, ctx).key).toBe('chats.system.offer_rejected.theirs');
    expect(systemLineParams('deal_cancelled', { by: 'nobody', reason: '<script>' }, ctx).keyParams.reason).toBe('chats.cancelReason.other');
    expect(systemLineParams('deal_dispute_resolved', { outcome: 'completed', message: 'Refund agreed' }, ctx).supportMessage).toBe('Refund agreed');
  });
});

describe('addMessageToPages', () => {
  it('adds a newer message on top once, even when the socket and the send reply both bring it', () => {
    const pages = [[msg(5), msg(4)], [msg(3)]];
    const once = addMessageToPages(pages, msg(6));
    expect(ids(once)).toEqual([['6', '5', '4'], ['3']]);
    expect(ids(addMessageToPages(once, msg(6, { text: 'y' })))).toEqual([['6', '5', '4'], ['3']]);
  });

  it('places an out-of-order message by seq and never one older than every loaded page', () => {
    const pages = [[msg(9), msg(7)], [msg(5)]];
    expect(ids(addMessageToPages(pages, msg(8)))).toEqual([['9', '8', '7'], ['5']]);
    expect(ids(addMessageToPages(pages, msg(6)))).toEqual([['9', '7'], ['6', '5']]);
    expect(ids(addMessageToPages(pages, msg(2)))).toEqual([['9', '7'], ['5']]);
    // Big seqs compare as numbers, not strings.
    expect(ids(addMessageToPages([[msg(10), msg(8)]], msg(9)))).toEqual([['10', '9', '8']]);
  });
});

describe('inbox rows from the socket', () => {
  const page = (items: InboxRow[], yourTurn = 0): InboxPage => ({ items, nextCursor: null, counts: { yourTurn } });

  it('moves the row to the top of a list it belongs to and out of one it no longer does', () => {
    const other = row({ threadId: 't0' });
    const prev = row({ unread: 0 });
    const next = row({ unread: 1, yourTurn: true });
    const delta = yourTurnDelta(prev, next)!;
    expect(delta).toBe(1);

    const all = applyInboxRow([page([other, prev], 2)], next, { filter: 'all', archived: false }, delta, null);
    expect(all[0]!.items.map((r) => r.threadId)).toEqual(['t1', 't0']);
    expect(all[0]!.counts.yourTurn).toBe(3);

    const selling = applyInboxRow([page([other])], next, { filter: 'selling', archived: false }, delta, null);
    expect(selling[0]!.items.map((r) => r.threadId)).toEqual(['t0']);

    const notMyTurn = applyInboxRow([page([prev], 1)], row({ yourTurn: false }), { filter: 'your_turn', archived: false }, -1, null);
    expect(notMyTurn[0]!.items).toEqual([]);
    expect(notMyTurn[0]!.counts.yourTurn).toBe(0);
  });

  it('keeps unread 0 for the open thread and asks the server when the row is unknown', () => {
    const placed = applyInboxRow([page([])], row({ unread: 3 }), { filter: 'all', archived: false }, 0, 't1');
    expect(placed[0]!.items[0]!.unread).toBe(0);
    expect(yourTurnDelta(undefined, row())).toBeNull();
    // Archived threads don't count toward Your turn.
    expect(yourTurnDelta(row({ yourTurn: true, archived: true }), row({ yourTurn: true, archived: false }))).toBe(1);
  });
});
