// The parts of a failed API call the app branches on. The API's `{ error, code, details }` body
// (CLAUDE.md "API response shape"); axios's own codes (ERR_NETWORK…) when no response came back.

interface ErrorLike {
  code?: string;
  response?: { status?: number; data?: { code?: string; details?: Record<string, unknown> } };
}

/** The API's stable code, else axios's (`ERR_NETWORK`), else `UNKNOWN`. */
export function errorCode(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  return e.response?.data?.code ?? e.code ?? 'UNKNOWN';
}

export function errorStatus(err: unknown): number | undefined {
  return ((err ?? {}) as ErrorLike).response?.status;
}

export function errorDetails(err: unknown): Record<string, unknown> {
  return ((err ?? {}) as ErrorLike).response?.data?.details ?? {};
}

/**
 * The translation key for a failed call: the code's key from `keys` when there is one, a network line when nothing
 * came back, else `fallback`. Server messages are English, so they are never shown as they are.
 */
export function errorKey(err: unknown, keys: Record<string, string>, fallback = 'errors.genericRetry'): string {
  const code = errorCode(err);
  if (keys[code]) return keys[code];
  // The session is ending (RootNavigator signs out); say the same thing it does.
  if (code === 'ACCOUNT_SUSPENDED') return 'errors.auth.suspended';
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED') return 'errors.network';
  return fallback;
}
