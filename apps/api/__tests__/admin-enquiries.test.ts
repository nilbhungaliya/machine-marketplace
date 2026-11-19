import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { chatMessages } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { auth, call, createOfferWorld, offerListing, setTestSettings, type OfferWorld } from './_helpers/test-offers.js';

// L2-5: admin Enquiries & offers API (F6 + F7 spec §16.1, §16.2): read-only, support / operations, no message or note
// text anywhere.

let w: OfferWorld;
let restore: () => Promise<void>;
const admins: Record<'support' | 'operations' | 'moderator', { id: string; token: string }> = {} as never;
const PLANTED = 'PLANTEDphrase7781';
let threadId: string;

const get = (token: string, url: string) => w.app.inject({ method: 'GET', url, headers: auth(token) });

beforeAll(async () => {
  w = await createOfferWorld(1);
  restore = await setTestSettings({ offer_open_limit_unverified: 50, enquiry_new_per_day_unverified: 100 });
  for (const role of ['support', 'operations', 'moderator'] as const) admins[role] = await createTestAdmin(role);

  const listingId = await offerListing(w);
  const sent = await call(w.app, w.buyers[0]!.token, 'POST', `/listings/${listingId}/offers`, {
    kind: 'offer',
    pricePerUnitPaise: 80_000,
    quantity: '2',
    note: `offer note ${PLANTED}`,
  });
  expect(sent.statusCode).toBe(200);
  threadId = sent.json().data.threadId;
  const countered = await call(w.app, w.seller.token, 'POST', `/offers/${sent.json().data.offer.id}/counter`, { pricePerUnitPaise: 95_000, quantity: '2', note: `counter ${PLANTED}` });
  expect(countered.statusCode).toBe(200);
  // A chat message with the phrase, as L1 would store it.
  await db.insert(chatMessages).values({ threadId, kind: 'text', senderSide: 'buyer', senderUserId: w.buyers[0]!.userId, text: `hello ${PLANTED}` });
});

afterAll(async () => {
  await restore?.();
  await deleteTestAdmins(Object.values(admins).map((a) => a.id));
  await w?.cleanup();
});

describe('admin enquiries', () => {
  it('lists threads with the open negotiation and shows the chain, never any text', async () => {
    const list = await get(admins.support.token, `/admin/enquiries?q=Test%20Works&pageSize=100`);
    expect(list.statusCode).toBe(200);
    const row = list.json().data.rows.find((r: { threadId: string }) => r.threadId === threadId);
    expect(row).toMatchObject({
      enquiryStatus: 'replied',
      dealCount: 0,
      negotiation: { round: 1, status: 'pending', lastPricePerUnitPaise: 95_000, quantity: '2', turn: 'buyer' },
    });
    expect(list.body).not.toContain(PLANTED);

    const detail = await get(admins.operations.token, `/admin/enquiries/${threadId}`);
    expect(detail.statusCode).toBe(200);
    const data = detail.json().data;
    expect(data.chain.map((c: { round: number; status: string; senderSide: string }) => [c.round, c.status, c.senderSide])).toEqual([
      [0, 'countered', 'buyer'],
      [1, 'pending', 'seller'],
    ]);
    expect(detail.body).not.toContain(PLANTED);
    expect(detail.body).not.toMatch(/"(note|text|rejectNote)"/);

    const filtered = await get(admins.support.token, '/admin/enquiries?enquiryStatus=converted&pageSize=100');
    expect(filtered.json().data.rows.some((r: { threadId: string }) => r.threadId === threadId)).toBe(false);
  });

  it('is for support and operations: a moderator gets 403', async () => {
    expect((await get(admins.moderator.token, '/admin/enquiries')).statusCode).toBe(403);
    expect((await get(admins.moderator.token, `/admin/enquiries/${threadId}`)).statusCode).toBe(403);
    expect((await get(admins.support.token, '/admin/enquiries')).statusCode).toBe(200);
    expect((await get(admins.operations.token, '/admin/enquiries')).statusCode).toBe(200);
  });
});
