import { assetUrl, transport } from './transport';

const TOKEN_KEY = 'ri.token';
const BASE = '/api';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** True when the request failed because the device has no connectivity. */
  get isOffline() {
    return this.status === 0;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage may be blocked - the session then lasts for this tab only */
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export type QueryValue = string | number | boolean | null | undefined;

export function toQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  params?: Record<string, QueryValue>;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, params, signal } = options;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await transport(BASE + path + toQuery(params), { method, headers, body: payload, signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'OFFLINE', 'No connection to the server. Your work is saved on this device.');
  }

  if (response.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended. Please sign in again.');
  }
  if (!response.ok) {
    let code = 'ERROR';
    let message = `Request failed (${response.status})`;
    let details: unknown;
    try {
      const data = await response.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
      details = data?.error?.details;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, code, message, details);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (options.raw || !contentType.includes('application/json')) {
    return (await response.blob()) as unknown as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal) =>
    request<T>(path, { params, signal }),
  post: <T>(path: string, body?: unknown, params?: Record<string, QueryValue>) =>
    request<T>(path, { method: 'POST', body, params }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, params?: Record<string, QueryValue>) =>
    request<T>(path, { method: 'DELETE', params }),
};

/** Opens a generated report in a new tab, carrying the session token. */
export function reportUrl(path: string, params?: Record<string, QueryValue>): string {
  const token = getToken();
  const query = toQuery({ ...(params ?? {}), access_token: token });
  return BASE + path + query;
}

/** URL of a stored evidence file - an embedded data URL in the demo build. */
export function fileUrl(storedName: string, download = false): string {
  const embedded = assetUrl(storedName);
  if (embedded) return embedded;
  return `${BASE}/files/${storedName}${toQuery({ access_token: getToken(), download: download ? 1 : undefined })}`;
}
