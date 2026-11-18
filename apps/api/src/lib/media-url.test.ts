import { afterEach, describe, expect, it } from 'vitest';
import { publicUrl } from './media-url.js';

// Public media URLs (F2 spec §6.1, plan Task 6): built at read time from MEDIA_PUBLIC_BASE_URL, read per call, so read
// endpoints work with no storage configured.

const saved = process.env.MEDIA_PUBLIC_BASE_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
  else process.env.MEDIA_PUBLIC_BASE_URL = saved;
});

describe('publicUrl', () => {
  it('is null when MEDIA_PUBLIC_BASE_URL is unset or blank', () => {
    delete process.env.MEDIA_PUBLIC_BASE_URL;
    expect(publicUrl('listings/a/b/full.jpg')).toBeNull();
    process.env.MEDIA_PUBLIC_BASE_URL = '   ';
    expect(publicUrl('listings/a/b/full.jpg')).toBeNull();
  });

  it('joins the base and the key with exactly one slash', () => {
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.com';
    expect(publicUrl('listings/a/b/full.jpg')).toBe('https://media.example.com/listings/a/b/full.jpg');
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.com/';
    expect(publicUrl('listings/a/b/full.jpg')).toBe('https://media.example.com/listings/a/b/full.jpg');
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.com//';
    expect(publicUrl('/listings/a/b/full.jpg')).toBe('https://media.example.com/listings/a/b/full.jpg');
  });

  it('is null for a missing key', () => {
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.com';
    expect(publicUrl(null)).toBeNull();
    expect(publicUrl(undefined)).toBeNull();
    expect(publicUrl('')).toBeNull();
  });

  it('reads the variable on every call', () => {
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://one.example.com';
    expect(publicUrl('k.jpg')).toBe('https://one.example.com/k.jpg');
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://two.example.com';
    expect(publicUrl('k.jpg')).toBe('https://two.example.com/k.jpg');
  });
});
