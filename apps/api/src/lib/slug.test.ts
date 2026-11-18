import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('lowercases, turns & into and, drops apostrophes, collapses punctuation', () => {
    expect(slugify('Sewing, Embroidery & Garments')).toBe('sewing-embroidery-and-garments');
    expect(slugify("Men's Wear")).toBe('mens-wear');
    expect(slugify('Shuttle (Schiffli) Embroidery Machine')).toBe('shuttle-schiffli-embroidery-machine');
    expect(slugify('  Water Jet Loom  ')).toBe('water-jet-loom');
  });

  it('drops accents instead of splitting the word', () => {
    expect(slugify('Lässer')).toBe('lasser');
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });
});
