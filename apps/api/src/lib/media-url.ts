// Public media URLs (F2 spec §6.1): `listing_media` stores public-bucket keys only; the URL is built at read time from
// `MEDIA_PUBLIC_BASE_URL`, read on every call, so read endpoints work (with null URLs) when no storage is configured.

/** `<MEDIA_PUBLIC_BASE_URL>/<key>` with exactly one slash between them; null without a base URL or a key. */
export function publicUrl(key: string | null | undefined): string | null {
  const base = process.env.MEDIA_PUBLIC_BASE_URL?.trim();
  if (!base || !key) return null;
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}
