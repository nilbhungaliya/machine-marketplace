import { describe, expect, it } from 'vitest';
import {
  acceptPhotos, composerState, enquiryBody, enquiryDefaults, enquiryProblem, messageProblem, quickOptionsFor, sendResets,
} from './chat-composer';

describe('composerState', () => {
  it('a viewer reads only; a block either way replaces the composer; otherwise writable', () => {
    expect(composerState({ memberRole: 'viewer', blockState: 'none', canWrite: false })).toEqual({ canWrite: false, reasonKey: 'chats.composer.viewer' });
    expect(composerState({ memberRole: 'owner', blockState: 'blocked_by_me', canWrite: false }).reasonKey).toBe('chats.composer.blockedByMe');
    expect(composerState({ memberRole: 'sales', blockState: 'blocked_me', canWrite: false }).reasonKey).toBe('chats.composer.blockedMe');
    expect(composerState({ memberRole: 'owner', blockState: 'none', canWrite: true })).toEqual({ canWrite: true, reasonKey: null });
    // The server's canWrite wins even when nothing else explains it.
    expect(composerState({ memberRole: 'owner', blockState: 'none', canWrite: false }).canWrite).toBe(false);
  });
});

describe('photos and text limits', () => {
  it('takes at most 5 photos a message and says when some were left out', () => {
    expect(acceptPhotos(0, 3)).toEqual({ accepted: 3, overflow: false });
    expect(acceptPhotos(3, 4)).toEqual({ accepted: 2, overflow: true });
    expect(acceptPhotos(5, 1)).toEqual({ accepted: 0, overflow: true });
  });

  it('a message needs text or photos, and text ≤ 2 000 after trim (a caption too)', () => {
    expect(messageProblem('   ', 0)).toBe('empty');
    expect(messageProblem('', 2)).toBeNull();
    expect(messageProblem(`  ${'a'.repeat(2000)}  `, 0)).toBeNull();
    expect(messageProblem('a'.repeat(2001), 1)).toBe('tooLong');
  });
});

describe('sendResets', () => {
  it('starts a new message after a spent photo or a reused id, and retries the same one otherwise', () => {
    for (const code of ['PHOTO_INVALID', 'PHOTO_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED', 'CLIENT_MESSAGE_ID_REUSED']) {
      expect(sendResets(code)).toBe(true);
    }
    for (const code of ['ERR_NETWORK', 'RATE_LIMITED', 'THREAD_BLOCKED', 'UNKNOWN']) expect(sendResets(code)).toBe(false);
  });
});

describe('enquiry', () => {
  const listing = { kind: 'part' as const, priceModel: 'on_request' as const, minOrderQty: '2' };

  it('Ask price preselects Price please with the minimum order; options follow the price model and kind', () => {
    expect(enquiryDefaults(listing, 'ask_price')).toMatchObject({ quick: ['price_request'], quantityText: '2' });
    expect(quickOptionsFor(listing)).toContain('price_request');
    expect(quickOptionsFor({ kind: 'machine', priceModel: 'negotiable' })).toEqual(
      expect.not.arrayContaining(['price_request', 'compatibility']),
    );
  });

  it('needs an option or a note, a note ≤ 500, a valid quantity for Best price; sends the machine only with fit', () => {
    const base = enquiryDefaults({ minOrderQty: null });
    expect(enquiryProblem(base, 0)).toBe('empty');
    expect(enquiryProblem({ ...base, note: 'x'.repeat(501) }, 0)).toBe('noteTooLong');
    expect(enquiryProblem({ ...base, quick: ['best_price'], quantityText: '2.5' }, 0)).toEqual({ quantity: 'decimals' });
    const machine = { brandId: 'b', modelId: null, year: 2018 };
    expect(enquiryBody({ ...base, quick: ['is_available'] }, 0, machine)).toEqual({ quick: ['is_available'], quantity: null, note: null, fit: null });
    expect(enquiryBody({ ...base, quick: ['compatibility', 'best_price'], quantityText: '३' }, 0, machine)).toMatchObject({
      quantity: '3',
      fit: machine,
    });
  });
});
