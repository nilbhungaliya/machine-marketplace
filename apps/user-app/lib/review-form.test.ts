import { describe, expect, it } from 'vitest';
import { DEAL_LIMITS } from '@mpm/shared-types';
import { filledStars, oneDecimal, replyProblem, scoreDisplay, validateReview } from './review-form';

const buyerRatings = { matched_listing: 5, communication: 4, on_time: 3 };
const sellerRatings = { communication: 5, payment: 4, pickup: 2 };

describe('validateReview (§10.2)', () => {
  it("accepts exactly the buyer's three facets with text", () => {
    expect(validateReview('buyer', { ratings: buyerRatings, text: '  As described  ' })).toEqual({
      ok: true,
      body: { ratings: buyerRatings, text: 'As described' },
    });
  });

  it("accepts the seller's three facets, stars only", () => {
    expect(validateReview('seller', { ratings: sellerRatings, text: '' })).toEqual({ ok: true, body: { ratings: sellerRatings } });
  });

  it('leaves empty text out of the body', () => {
    expect(validateReview('buyer', { ratings: buyerRatings, text: '   ' })).toEqual({ ok: true, body: { ratings: buyerRatings } });
  });

  it('requires every facet of the side, as a whole 1-5 star', () => {
    const r = validateReview('buyer', { ratings: { matched_listing: 0, communication: 4.5 }, text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toEqual([
        { field: 'matched_listing', problem: 'missing' },
        { field: 'communication', problem: 'missing' },
        { field: 'on_time', problem: 'missing' },
      ]);
    }
  });

  it("uses the side's facets, not the other side's, and drops extras", () => {
    const r = validateReview('seller', { ratings: { ...buyerRatings, payment: 3 }, text: '' });
    expect(r.ok).toBe(false);
    // `communication` is a facet of both sides; `pickup` is the seller's own and missing.
    if (!r.ok) expect(r.problems.map((p) => p.field)).toEqual(['pickup']);
    const ok = validateReview('seller', { ratings: { ...sellerRatings, matched_listing: 5 }, text: '' });
    expect(ok).toEqual({ ok: true, body: { ratings: sellerRatings } });
  });

  it('refuses text on the seller to buyer review', () => {
    const r = validateReview('seller', { ratings: sellerRatings, text: 'Paid late' });
    expect(r).toEqual({ ok: false, problems: [{ field: 'text', problem: 'notAllowed' }] });
  });

  it('caps buyer text at the limit', () => {
    const max = 'a'.repeat(DEAL_LIMITS.reviewTextMax);
    expect(validateReview('buyer', { ratings: buyerRatings, text: max }).ok).toBe(true);
    expect(validateReview('buyer', { ratings: buyerRatings, text: `${max}a` })).toEqual({
      ok: false,
      problems: [{ field: 'text', problem: 'tooLong' }],
    });
  });
});

describe('scoreDisplay (§10.4)', () => {
  const facets = { matched_listing: 90, communication: 90, on_time: 90 };

  it('is "New seller" without a score', () => {
    expect(scoreDisplay(null)).toEqual({ kind: 'new' });
    expect(scoreDisplay(undefined)).toEqual({ kind: 'new' });
  });

  it('rounds half up to one decimal', () => {
    expect(scoreDisplay({ count: 3, stars: 4.25, facetsPercent: facets })).toEqual({ kind: 'score', stars: '4.3', count: 3, filled: 4 });
    expect(scoreDisplay({ count: 12, stars: 4.75, facetsPercent: facets })).toEqual({ kind: 'score', stars: '4.8', count: 12, filled: 5 });
    expect(oneDecimal(4.04)).toBe('4.0');
    expect(oneDecimal(5)).toBe('5.0');
  });

  it('fills whole stars', () => {
    expect(filledStars(3.4)).toBe(3);
    expect(filledStars(3.5)).toBe(4);
    expect(filledStars(9)).toBe(5);
  });
});

describe('replyProblem (§10.5)', () => {
  it('needs 1 to 300 characters', () => {
    expect(replyProblem('  ')).toBe('empty');
    expect(replyProblem('Thank you')).toBeNull();
    expect(replyProblem('a'.repeat(DEAL_LIMITS.replyMax + 1))).toBe('tooLong');
  });
});
