/**
 * A document's real type from its first bytes (textile `services/uploads/admin-documents.ts` `sniffDocument`): JPEG,
 * PNG, WebP or PDF, else null. The name and the type the client claimed are never trusted (F1 + A2 spec §6). 16 bytes
 * are enough for every type here.
 */
export type DocumentKind = 'jpg' | 'png' | 'webp' | 'pdf';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffDocument(bytes: Buffer): DocumentKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}
