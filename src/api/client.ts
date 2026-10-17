// fetch wrapper: same origin cookies, JSON, and the CSRF header on every write.
import type { ApiErrorBody } from '../../shared/types';

let csrfToken: string | null = null;

/** Called with every session response so writes carry the current token. */
export function setCsrf(token: string | null | undefined): void {
  csrfToken = token ?? null;
}

export class ApiError extends Error {
  name = 'ApiError';
  constructor(public status: number, message: string, public code?: string, public field?: string) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  let payload: BodyInit | undefined;
  if (raw) {
    headers['content-type'] = raw.type || 'application/octet-stream';
    payload = raw;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Check your connection and try again.', 'offline');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody> & { field?: string };
    throw new ApiError(res.status, err.error ?? 'Something went wrong. Please try again.', err.code, err.field);
  }
  const maybe = data as { csrf?: unknown } | null;
  if (maybe && typeof maybe === 'object' && typeof maybe.csrf === 'string') setCsrf(maybe.csrf);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /** Send raw bytes, e.g. a resized JPEG to /api/photos. */
  upload: <T>(path: string, blob: Blob) => request<T>('POST', path, undefined, blob),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}
