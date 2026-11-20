import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Language, NotificationType } from '@mpm/shared-types';
import type { notifications } from '../src/db/schema.js';
import { pushMessageFor } from '../src/services/notifications/push-sender.js';
import { renderNotification } from '../src/services/notifications/render.js';

// A3-2: F8 notification texts (spec §10.3) and the grouped rows' push tag (§10.2). No database: rendering is pure.

const LANGUAGES: Language[] = ['en', 'hi', 'gu'];
const F8_TYPES: NotificationType[] = [
  'part_request_new',
  'part_request_reply',
  'part_match',
  'part_request_expiring',
  'part_request_expired',
  'part_request_fulfil_prompt',
  'part_request_removed',
  'part_request_reply_dropped',
];
const PARAMS = {
  requestTitle: 'Temple roller',
  side: 'left',
  quantity: '4',
  unitLabel: 'pieces',
  city: 'Surat',
  businessName: 'Shree Parts',
  listingTitle: 'Temple roller LH',
  distanceKm: 6,
  reason: 'request_expired',
};

describe('renderNotification for F8 types', () => {
  it('renders a non-empty title and body for each type in en / hi / gu, with and without params', () => {
    for (const language of LANGUAGES) {
      for (const type of F8_TYPES) {
        for (const params of [PARAMS, {}]) {
          const { title, body } = renderNotification(type, params, language);
          expect(title.trim(), `${type} ${language}`).not.toBe('');
          expect(body.trim(), `${type} ${language}`).not.toBe('');
        }
      }
    }
  });

  it('uses the §10.3 English lines, the grouped line for a count above 1', () => {
    expect(renderNotification('part_match', PARAMS, 'en')).toEqual({
      title: 'Your left Temple roller is available',
      body: 'Temple roller LH, 6 km away. Open it to make an offer.',
    });
    expect(renderNotification('part_match', PARAMS, 'en', 3).title).toBe('3 new matches for Temple roller');
    expect(renderNotification('part_request_reply', PARAMS, 'en').title).toBe('Shree Parts replied to your requirement');
    expect(renderNotification('part_request_reply', PARAMS, 'en', 3).title).toBe('3 replies for Temple roller');
    expect(renderNotification('part_request_new', PARAMS, 'en')).toEqual({
      title: 'A buyer needs Temple roller',
      body: 'Left · 4 pieces · Surat',
    });
    expect(renderNotification('part_request_fulfil_prompt', PARAMS, 'en')).toEqual({
      title: 'Deal agreed with Shree Parts',
      body: 'Mark Temple roller fulfilled?',
    });
    expect(renderNotification('part_request_reply_dropped', PARAMS, 'en').body).toBe('The requirement expired.');
    for (const language of ['hi', 'gu'] as const) {
      expect(renderNotification('part_match', PARAMS, language, 3).title).toContain('3');
      expect(renderNotification('part_request_reply', PARAMS, language, 3).title).toContain('3');
      expect(renderNotification('part_match', PARAMS, language, 3).title).not.toBe(renderNotification('part_match', PARAMS, language).title);
    }
  });

  it('masks a phone in the request title, in Latin and Gujarati digits, in every language', () => {
    for (const requestTitle of ['Roller +91 98765 43210', 'Roller ૯૮૭૬૫૪૩૨૧૦']) {
      for (const language of LANGUAGES) {
        for (const type of F8_TYPES) {
          const { title, body } = renderNotification(type, { ...PARAMS, requestTitle }, language);
          const text = `${title} ${body}`;
          expect(text, `${type} ${language}`).not.toMatch(/98765|43210|૯૮૭૬૫|૪૩૨૧૦/);
        }
      }
    }
  });

  it('renders distanceKm as the stored integer and ignores a non-integer or unknown side', () => {
    expect(renderNotification('part_match', { ...PARAMS, distanceKm: 12 }, 'en').body).toContain('12 km away');
    expect(renderNotification('part_match', { ...PARAMS, distanceKm: '7' }, 'en').body).toContain('7 km away');
    expect(renderNotification('part_match', { ...PARAMS, distanceKm: 6.37 }, 'en').body).not.toContain('km');
    expect(renderNotification('part_match', { ...PARAMS, side: 'top' }, 'en').title).toBe('Your Temple roller is available');
  });
});

describe('pushMessageFor (F8)', () => {
  const row = (type: NotificationType, partRequestId: string | null): typeof notifications.$inferSelect => ({
    id: randomUUID(),
    userId: randomUUID(),
    businessId: randomUUID(),
    type,
    category: 'requests',
    params: PARAMS,
    threadId: null,
    offerId: null,
    dealId: null,
    reviewId: null,
    partRequestId,
    dedupeKey: `${type}:${randomUUID()}`,
    unreadCount: 2,
    lastSeq: null,
    version: 3,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as typeof notifications.$inferSelect;

  it('tags a grouped part_match row part_request:<id>:part_match and carries data.partRequestId', () => {
    const requestId = randomUUID();
    const n = row('part_match', requestId);
    const msg = pushMessageFor(n, { version: 3 }, 'tok', 'en');
    expect(msg.tag).toBe(`part_request:${requestId}:part_match`);
    expect(msg.data).toMatchObject({ tag: msg.tag, partRequestId: requestId, deliveryKey: `${n.id}:3`, type: 'part_match' });
    expect(msg.title).toBe('2 new matches for Temple roller');
    const reply = pushMessageFor(row('part_request_reply', requestId), { version: 1 }, 'tok', 'hi');
    expect(reply.tag).toBe(`part_request:${requestId}:part_request_reply`);
  });

  it('keeps the notification id as the tag for the other request types, with data.partRequestId', () => {
    const requestId = randomUUID();
    const n = row('part_request_expired', requestId);
    const msg = pushMessageFor(n, { version: 1 }, 'tok', 'gu');
    expect(msg.tag).toBe(n.id);
    expect(msg.data.partRequestId).toBe(requestId);
  });
});
