import type { CdnPurgeResult } from '@mpm/shared-types';
import { Sentry } from './sentry.js';

/**
 * Purges deleted media URLs from the Cloudflare cache (F2 spec §6.1, R45): every media deletion (seller, admin, draft
 * delete) calls this after the objects are deleted, because the edge keeps a copy for a year. `POST
 * /zones/<CLOUDFLARE_ZONE_ID>/purge_cache` with `{ files }`, at most 30 URLs per call (Cloudflare's per-request limit
 * on most plans). Never throws: the database change has committed already.
 * - no zone configured (dev on `r2.dev`) → `'skipped'`;
 * - all chunks answered `success` → `'ok'`;
 * - anything else (no token, a non-2xx, `success: false`, a network error or timeout) → logged, reported to Sentry,
 *   `'failed'` (the admin sees "Deleted. The CDN copy may take a while to clear.").
 */

export const PURGE_CHUNK_SIZE = 30;
export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const PURGE_TIMEOUT_MS = 10_000;

type Log = { error: (obj: unknown, msg?: string) => void };
const consoleLog: Log = { error: (obj, msg) => console.error(msg, obj) };

export interface PurgeOptions {
  /** The API base, overridable for tests (a local fake server). */
  apiBase?: string;
  log?: Log;
}

export async function purgeUrls(urls: string[], opts: PurgeOptions = {}): Promise<CdnPurgeResult> {
  const zone = process.env.CLOUDFLARE_ZONE_ID?.trim();
  if (!zone) return 'skipped';
  const files = [...new Set(urls.filter((u) => u.trim() !== ''))];
  if (files.length === 0) return 'ok';
  const log = opts.log ?? consoleLog;
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    const err = new Error('CDN purge: CLOUDFLARE_ZONE_ID is set but CLOUDFLARE_API_TOKEN is not');
    log.error({ err: err.message, count: files.length }, 'cdn: purge not possible');
    Sentry.captureException(err, { tags: { cdn: 'purge' } });
    return 'failed';
  }

  const endpoint = `${(opts.apiBase ?? CLOUDFLARE_API_BASE).replace(/\/+$/, '')}/zones/${encodeURIComponent(zone)}/purge_cache`;
  let failed = false;
  for (let i = 0; i < files.length; i += PURGE_CHUNK_SIZE) {
    const chunk = files.slice(i, i + PURGE_CHUNK_SIZE);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: chunk }),
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: unknown } | null;
      if (!res.ok || body?.success !== true) {
        throw new Error(`CDN purge answered ${res.status}${body?.errors ? `: ${JSON.stringify(body.errors).slice(0, 300)}` : ''}`);
      }
    } catch (err) {
      // Every chunk is still tried: one bad chunk shouldn't leave the others' URLs cached.
      failed = true;
      log.error({ err: err instanceof Error ? err.message : String(err), count: chunk.length }, 'cdn: purge failed');
      Sentry.captureException(err, { tags: { cdn: 'purge' } });
    }
  }
  return failed ? 'failed' : 'ok';
}
