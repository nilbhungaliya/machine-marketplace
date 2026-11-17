const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

// Exported so auth-context posts to the same string this module special-cases below.
export const ADMIN_LOGIN_PATH = '/admin/auth/login';

export const TOKEN_KEY = 'admin_token';
export const USER_KEY = 'admin_user';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function clearSessionAndBounce(): never {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = '/login';
  throw new ApiError('Unauthorized', 401);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // A 401 normally means the session went stale. Signing in is the exception: a
  // wrong password is ALSO a 401, and bouncing would wipe the error message.
  if (res.status === 401 && path !== ADMIN_LOGIN_PATH) clearSessionAndBounce();

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || 'Request failed', res.status, json.code, json.details);

  // API success shape is { data: T }.
  return (json.data ?? json) as T;
}

const withBody = (method: string) => <T>(path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal }) => request<T>(path, { signal: opts?.signal }),
  post: withBody('POST'),
  put: withBody('PUT'),
  patch: withBody('PATCH'),
  delete: withBody('DELETE'),
};
