import type { GstMode } from '@mpm/shared-types';
import { hasGstProvider } from './gst-provider.js';

/**
 * The single GST switch every route and screen reads (F1 + A2 spec §5.1):
 * - `review` first when `GST_PROVIDER=off`: it forces review anywhere, even with an adapter and a key (ruling R6);
 * - `live`   — a provider adapter is registered (`setGstProvider`) **and** `GST_API_KEY` is non-empty;
 * - `stub`   — `NODE_ENV` isn't `production` and `GST_PROVIDER` is unset, empty or `stub`;
 * - `review` — everything else (production without a working provider, a `GST_PROVIDER` naming a provider whose
 *   adapter or key is missing). The stub never runs in production.
 * Read on every call (not cached), so tests and a restart with new env both take effect.
 */
export function getGstMode(): GstMode {
  const named = (process.env.GST_PROVIDER ?? '').trim();
  if (named === 'off') return 'review';
  if (hasGstProvider() && (process.env.GST_API_KEY ?? '').trim() !== '') return 'live';
  if (process.env.NODE_ENV !== 'production' && (named === '' || named === 'stub')) return 'stub';
  return 'review';
}
