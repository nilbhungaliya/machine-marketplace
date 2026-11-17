import { ApiError } from './api';

export type LoadErrorKind = 'not_found' | 'forbidden' | 'failed';

/**
 * How a page should explain a failed load. 401 never gets here as its own
 * case: the API client already drops the session and sends the admin to login.
 */
export function classifyLoadError(e: unknown): LoadErrorKind {
  if (e instanceof ApiError) {
    if (e.status === 404) return 'not_found';
    if (e.status === 403) return 'forbidden';
  }
  return 'failed';
}
