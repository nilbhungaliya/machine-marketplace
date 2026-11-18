import { VIDEO_FTYP_BRANDS, type MediaRole } from '@mpm/shared-types';

/**
 * Listing media's real type from its first bytes (F2 spec §6.3, R46). The stored key's extension and the served
 * `Content-Type` follow this, never the client's claim.
 * - `full`, `thumb`, `poster`: **JPEG only** (`FF D8 FF`): every photo and poster leaves the device through the
 *   manipulator as JPEG.
 * - `video`: an `ftyp` box at bytes 4–8 whose major brand (bytes 8–12) is on `VIDEO_FTYP_BRANDS`; `qt  ` → QuickTime,
 *   the rest → MP4. HEIC (`heic`, `mif1`) and AVIF (`avif`) also start with `ftyp` and are refused by the list.
 */

export interface SniffedMedia {
  ext: 'jpg' | 'mp4' | 'mov';
  contentType: 'image/jpeg' | 'video/mp4' | 'video/quicktime';
}

/** How many bytes the attach path reads and the EXIF walk looks at (§6.2, §6.4). */
export const MEDIA_SNIFF_BYTES = 65_536;

const FTYP_BRANDS: ReadonlySet<string> = new Set(VIDEO_FTYP_BRANDS);

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

const latin1 = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));

export function sniffMedia(bytes: Uint8Array, role: MediaRole): SniffedMedia | null {
  if (role !== 'video') return isJpeg(bytes) ? { ext: 'jpg', contentType: 'image/jpeg' } : null;
  if (bytes.length < 12 || latin1(bytes, 4, 8) !== 'ftyp') return null;
  const brand = latin1(bytes, 8, 12);
  if (!FTYP_BRANDS.has(brand)) return null;
  return brand === 'qt  ' ? { ext: 'mov', contentType: 'video/quicktime' } : { ext: 'mp4', contentType: 'video/mp4' };
}

/**
 * What the header segments of a JPEG say about metadata, walking them in the first 64 KB until the image data starts
 * (`SOS`) or the image ends (`EOI`):
 * - `exif`: an `APP1` segment starts with `Exif\0\0` (the EXIF block that carries GPS);
 * - `clean`: the header ended without one;
 * - `incomplete`: the walk ran out of bytes (truncated, malformed, or a header longer than 64 KB), so the answer is
 *   unknown. The attach path refuses that too; `jpegHasExif` answers false for it.
 * Not a JPEG → `clean` (nothing to walk; the sniff refuses it anyway).
 */
export type JpegHeaderStatus = 'exif' | 'clean' | 'incomplete';

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

export function jpegHeaderStatus(input: Uint8Array): JpegHeaderStatus {
  if (!isJpeg(input)) return 'clean';
  const b = input.subarray(0, MEDIA_SNIFF_BYTES);
  let i = 2; // past SOI (FF D8)
  while (i < b.length) {
    if (b[i] !== 0xff) return 'incomplete';
    // Fill bytes: any number of FF before the marker code.
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) return 'incomplete';
    const marker = b[i]!;
    i++;
    if (marker === 0xda || marker === 0xd9) return 'clean'; // SOS: image data follows; EOI: the end
    // Markers without a length: TEM and RST0–7 (SOI again would be malformed, treated the same way).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (i + 2 > b.length) return 'incomplete';
    const length = (b[i]! << 8) | b[i + 1]!; // includes its own two bytes
    if (length < 2) return 'incomplete';
    if (marker === 0xe1 && i + 2 + EXIF_ID.length <= b.length && EXIF_ID.every((v, k) => b[i + 2 + k] === v)) return 'exif';
    i += length;
  }
  return 'incomplete';
}

/** True when the JPEG's header carries an EXIF `APP1` segment in its first 64 KB (§6.4, `400 MEDIA_METADATA`). Never throws. */
export function jpegHasExif(bytes: Uint8Array): boolean {
  return jpegHeaderStatus(bytes) === 'exif';
}
