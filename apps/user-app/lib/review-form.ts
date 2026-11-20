import { DEAL_LIMITS, REVIEW_FACETS, type PartySide, type ReviewFacet, type SellerScore } from '@mpm/shared-types';

// The review form (F6 + F7 spec §10.2, §10.4; plan L8-1). Pure: the screens and the API agree on the same rules, so the
// form never sends what the server would refuse with `400 REVIEW_ANSWERS_INVALID`.

/** The facets the reviewer rates, by the reviewer's side: the buyer rates the seller (3 facets) and back. */
export function reviewFacets(side: PartySide): readonly ReviewFacet[] {
  return REVIEW_FACETS.deal[side]; // M14: A3/B-lanes pass the subject (rental seller rates care, not pickup)
}

/** Only the buyer's review of the seller has text (public, ≤ 1 000); the seller's review of the buyer is stars only. */
export function reviewHasText(side: PartySide): boolean {
  return side === 'buyer';
}

export interface ReviewValues {
  ratings: Partial<Record<string, number>>;
  text: string;
}

export type ReviewProblem = { field: ReviewFacet; problem: 'missing' } | { field: 'text'; problem: 'tooLong' | 'notAllowed' };

export type ReviewCheck =
  | { ok: true; body: { ratings: Record<string, number>; text?: string } }
  | { ok: false; problems: ReviewProblem[] };

const wholeStar = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * Exactly the side's facets, each a whole 1–5 star; anything else in `ratings` is dropped. Text only on the buyer's side,
 * trimmed, ≤ `DEAL_LIMITS.reviewTextMax`; empty text is left out of the body.
 */
export function validateReview(side: PartySide, values: ReviewValues): ReviewCheck {
  const facets = reviewFacets(side);
  const problems: ReviewProblem[] = [];
  const ratings: Record<string, number> = {};
  for (const facet of facets) {
    const v = values.ratings[facet];
    if (wholeStar(v)) ratings[facet] = v;
    else problems.push({ field: facet, problem: 'missing' });
  }
  const text = values.text.trim();
  if (text !== '' && !reviewHasText(side)) problems.push({ field: 'text', problem: 'notAllowed' });
  else if (text.length > DEAL_LIMITS.reviewTextMax) problems.push({ field: 'text', problem: 'tooLong' });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, body: text !== '' ? { ratings, text } : { ratings } };
}

/** One decimal, half up (4.25 → "4.3"), in ASCII digits; a float error just under .x5 still rounds up. */
export function oneDecimal(n: number): string {
  const tenths = Math.floor(n * 10 + 0.5 + 1e-9);
  return (tenths / 10).toFixed(1);
}

export type ScoreDisplay = { kind: 'new' } | { kind: 'score'; stars: string; count: number; filled: number };

/**
 * How a seller's score reads (§10.4): "New seller" until the server returns a score (≥ `review_min_published`
 * published reviews), else the stars to one decimal, the count, and how many of five stars to fill (rounded).
 */
export function scoreDisplay(score: SellerScore | null | undefined): ScoreDisplay {
  if (!score || score.count <= 0) return { kind: 'new' };
  const stars = oneDecimal(score.stars);
  return { kind: 'score', stars, count: score.count, filled: Math.min(5, Math.max(0, Math.round(Number(stars)))) };
}

/** A review's own stars (the facets' mean, one decimal from the server) as filled stars out of five. */
export function filledStars(stars: number): number {
  return Math.min(5, Math.max(0, Math.round(stars)));
}

/** A reply is 1–300 characters after trimming (§10.5). */
export function replyProblem(text: string): 'empty' | 'tooLong' | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > DEAL_LIMITS.replyMax) return 'tooLong';
  return null;
}
