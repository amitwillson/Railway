/**
 * Offline demonstration adapter.
 *
 * In the demo build the API client's `fetch` is replaced by this function. It
 * parses the request exactly as the server would, hands it to the in-browser
 * router and returns a real `Response`, so nothing else in the application
 * changes - the same screens, the same state handling, the same error paths.
 */
import { DemoError, handle, demoImage } from './router';

const BASE = '/api';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Multipart bodies (compliance and evidence uploads) are unpacked into plain
 * fields plus a `__files` list the router understands.
 */
async function readBody(init?: RequestInit): Promise<any> {
  if (!init?.body) return undefined;
  if (typeof init.body === 'string') {
    try {
      return JSON.parse(init.body);
    } catch {
      return undefined;
    }
  }
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
    const body: Record<string, unknown> = { __files: [] as unknown[] };
    for (const [key, value] of init.body.entries()) {
      if (typeof File !== 'undefined' && value instanceof File) {
        (body.__files as unknown[]).push({ name: value.name, size: value.size });
      } else {
        body[key] = value;
      }
    }
    return body;
  }
  return undefined;
}

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, 'http://demo.local');
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  const token = (init?.headers as Record<string, string> | undefined)?.authorization?.replace(/^Bearer\s+/i, '')
    ?? url.searchParams.get('access_token');

  // A small delay keeps loading states visible, as they are against a server.
  await new Promise((resolve) => setTimeout(resolve, 40));

  try {
    const payload = handle({ method, path, query: url.searchParams, token: token ?? null, body: await readBody(init) });
    return json(method === 'POST' && /^\/(observations|inspections)$/.test(path) && !(payload as any)?.deduplicated ? 201 : 200, payload);
  } catch (error) {
    if (error instanceof DemoError) {
      return json(error.status, { error: { code: error.code, message: error.message, details: error.details } });
    }
    return json(500, {
      error: { code: 'INTERNAL', message: error instanceof Error ? error.message : 'Unexpected error' },
    });
  }
}

export { demoImage };
export const IS_DEMO = true;
