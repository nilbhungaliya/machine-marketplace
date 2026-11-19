import { describe, expect, it } from 'vitest';
import type { DealListRow, DealsPage } from '@mpm/shared-types';
import { parseDealUpdated, patchDealsPages } from './socket-deals';

const row = (id: string, status: DealListRow['status']): DealListRow => ({
  id, ref: 500001, threadId: 't', listingId: 'l', side: 'buyer',
  counterpart: { businessId: 'b', name: 'Kamal', gstVerified: true }, listingTitle: 'Cylinder', thumbUrl: null,
  pricePerUnitPaise: 3_650_000, quantity: '2', unitLabel: 'pcs', totalPaise: '7300000', gstMode: 'extra', status,
  yourTurn: false, acceptedAt: 'x', handedOverAt: null, autoCompleteAt: null, completedAt: null, cancelledAt: null, updatedAt: 'x',
});
const page = (items: DealListRow[]): DealsPage => ({ items, nextCursor: null, counts: { active: 1, completed: 0, cancelled: 0, yourTurn: 0 } });

describe('deal:updated (§13)', () => {
  it('reads only well-formed payloads', () => {
    expect(parseDealUpdated({ dealId: 'd', threadId: 't', status: 'handed_over', version: 3 }))
      .toEqual({ dealId: 'd', threadId: 't', status: 'handed_over', version: 3 });
    expect(parseDealUpdated({ dealId: 'd', threadId: 't', status: 'shipped', version: 3 })).toBeNull();
    expect(parseDealUpdated({ dealId: 'd', status: 'agreed', version: 1 })).toBeNull();
    expect(parseDealUpdated(null)).toBeNull();
  });
  it('patches the row in every page and leaves other rows and unchanged data alone', () => {
    const data = { pages: [page([row('a', 'agreed')]), page([row('d', 'agreed')])], pageParams: [null, 'c'] };
    const out = patchDealsPages(data, { dealId: 'd', status: 'handed_over' })!;
    expect(out.pages[1]!.items[0]!.status).toBe('handed_over');
    expect(out.pages[0]).toBe(data.pages[0]);
    expect(patchDealsPages(data, { dealId: 'zzz', status: 'completed' })).toBe(data);
    expect(patchDealsPages(data, { dealId: 'a', status: 'agreed' })).toBe(data);
    expect(patchDealsPages(undefined, { dealId: 'a', status: 'agreed' })).toBeUndefined();
  });
});
