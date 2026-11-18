import { describe, expect, it } from 'vitest';
import { sniffDocument } from './sniff-document.js';

// A document's real type comes from its first bytes, never from its name or the type the client claimed (spec §6).

const bytes = (...parts: Array<number[] | string>) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

describe('sniffDocument', () => {
  it('recognises JPEG', () => {
    expect(sniffDocument(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF'))).toBe('jpg');
  });

  it('recognises PNG', () => {
    expect(sniffDocument(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], 'IHDR'))).toBe('png');
  });

  it('recognises WebP (RIFF....WEBP)', () => {
    expect(sniffDocument(bytes('RIFF', [0x24, 0x00, 0x00, 0x00], 'WEBPVP8 '))).toBe('webp');
  });

  it('recognises PDF', () => {
    expect(sniffDocument(bytes('%PDF-1.7\n%âãÏÓ'))).toBe('pdf');
  });

  it('refuses HTML, even one that mentions a PDF', () => {
    expect(sniffDocument(bytes('<html><body>%PDF-1.7</body></html>'))).toBeNull();
    expect(sniffDocument(bytes('<!DOCTYPE html>'))).toBeNull();
  });

  it('refuses an empty buffer and truncated magic', () => {
    expect(sniffDocument(Buffer.alloc(0))).toBeNull();
    expect(sniffDocument(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffDocument(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffDocument(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
    expect(sniffDocument(bytes('%PDF'))).toBeNull();
  });
});
