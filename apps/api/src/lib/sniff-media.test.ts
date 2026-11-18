import { describe, expect, it } from 'vitest';
import { MEDIA_SNIFF_BYTES, jpegHasExif, jpegHeaderStatus, sniffMedia } from './sniff-media.js';

// Listing media sniffing (F2 spec §6.3, §6.4, R46): JPEG only for images, an allow-listed `ftyp` brand for video, and
// the EXIF APP1 refusal. Byte fixtures built here.

const bytes = (...parts: Array<number[] | string | Uint8Array>) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

/** One JPEG segment: FF <marker> <length incl. itself> <payload>. */
const segment = (marker: number, payload: Uint8Array | string) => {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'latin1') : Buffer.from(payload);
  const len = body.length + 2;
  return bytes([0xff, marker, len >> 8, len & 0xff], body);
};
const SOI = [0xff, 0xd8];
const SOS = segment(0xda, Buffer.alloc(10));
const APP0_JFIF = segment(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const DQT = segment(0xdb, Buffer.alloc(65));
const APP1_EXIF = segment(0xe1, bytes('Exif\0\0', 'MM\0*', Buffer.alloc(20)));
const APP1_XMP = segment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta/>'));
const jpeg = (...segments: Uint8Array[]) => bytes(SOI, ...segments, SOS, Buffer.alloc(32, 0x11), [0xff, 0xd9]);

const ftyp = (brand: string) => bytes([0x00, 0x00, 0x00, 0x20], 'ftyp', brand, [0, 0, 0, 0], 'isommp41');

describe('sniffMedia', () => {
  it('JPEG as full, thumb and poster → jpg / image/jpeg', () => {
    for (const role of ['full', 'thumb', 'poster'] as const) {
      expect(sniffMedia(jpeg(APP0_JFIF), role)).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
    }
  });

  it('PNG, WebP and HTML bytes as an image → null', () => {
    expect(sniffMedia(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], 'IHDR'), 'full')).toBeNull();
    expect(sniffMedia(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '), 'thumb')).toBeNull();
    expect(sniffMedia(bytes('<!doctype html><html><body>hi</body></html>'), 'full')).toBeNull();
    expect(sniffMedia(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'poster')).toBeNull();
  });

  it('an image role never accepts video bytes, and the video role never accepts a JPEG', () => {
    expect(sniffMedia(ftyp('isom'), 'full')).toBeNull();
    expect(sniffMedia(jpeg(APP0_JFIF), 'video')).toBeNull();
  });

  it('ftypisom → mp4, ftypqt → mov, ftypM4V → mp4, every listed brand accepted', () => {
    expect(sniffMedia(ftyp('isom'), 'video')).toEqual({ ext: 'mp4', contentType: 'video/mp4' });
    expect(sniffMedia(ftyp('qt  '), 'video')).toEqual({ ext: 'mov', contentType: 'video/quicktime' });
    expect(sniffMedia(ftyp('M4V '), 'video')).toEqual({ ext: 'mp4', contentType: 'video/mp4' });
    for (const brand of ['iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', '3gp4', '3gp5', '3gp6', '3g2a']) {
      expect(sniffMedia(ftyp(brand), 'video')?.ext).toBe('mp4');
    }
  });

  it('HEIC, HEIF and AVIF brands → null', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'avif', 'avis']) expect(sniffMedia(ftyp(brand), 'video')).toBeNull();
  });

  it('no ftyp box at bytes 4–8, or too few bytes → null', () => {
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'moov', 'isom'), 'video')).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'ftyp', 'is'), 'video')).toBeNull();
    expect(sniffMedia(new Uint8Array(0), 'video')).toBeNull();
    expect(sniffMedia(new Uint8Array(0), 'full')).toBeNull();
  });
});

describe('jpegHasExif', () => {
  it('a JPEG with an APP1 Exif segment → true (also after APP0 and with fill bytes)', () => {
    expect(jpegHasExif(jpeg(APP1_EXIF))).toBe(true);
    expect(jpegHasExif(jpeg(APP0_JFIF, DQT, APP1_EXIF))).toBe(true);
    expect(jpegHasExif(bytes(SOI, [0xff, 0xff], APP1_EXIF.subarray(1), SOS))).toBe(true);
  });

  it('a JPEG with only APP0 JFIF → false', () => {
    expect(jpegHasExif(jpeg(APP0_JFIF, DQT))).toBe(false);
    expect(jpegHeaderStatus(jpeg(APP0_JFIF, DQT))).toBe('clean');
  });

  it('a JPEG with an APP1 XMP segment → false', () => {
    expect(jpegHasExif(jpeg(APP0_JFIF, APP1_XMP))).toBe(false);
  });

  it('an Exif-looking string after SOS (in the image data) is not a header segment → false', () => {
    expect(jpegHasExif(bytes(SOI, APP0_JFIF, SOS, APP1_EXIF, [0xff, 0xd9]))).toBe(false);
  });

  it('a truncated header → false, no throw, and its status is incomplete', () => {
    for (const b of [
      bytes(SOI, [0xff]),
      bytes(SOI, [0xff, 0xe1]),
      bytes(SOI, [0xff, 0xe1, 0x00]),
      bytes(SOI, APP0_JFIF.subarray(0, 8)),
      bytes(SOI, APP0_JFIF, [0x12, 0x34]),
      bytes(SOI, [0xff, 0xe0, 0x00, 0x01]),
    ]) {
      expect(() => jpegHasExif(b)).not.toThrow();
      expect(jpegHasExif(b)).toBe(false);
      expect(jpegHeaderStatus(b)).toBe('incomplete');
    }
  });

  it('EXIF beyond the first 64 KB is not seen: the header is incomplete (the attach path refuses that)', () => {
    const big = segment(0xe2, Buffer.alloc(MEDIA_SNIFF_BYTES - 10));
    const b = jpeg(APP0_JFIF, big, APP1_EXIF);
    expect(jpegHasExif(b)).toBe(false);
    expect(jpegHeaderStatus(b)).toBe('incomplete');
  });

  it('not a JPEG → false', () => {
    expect(jpegHasExif(bytes('Exif\0\0'))).toBe(false);
    expect(jpegHasExif(ftyp('isom'))).toBe(false);
  });
});
