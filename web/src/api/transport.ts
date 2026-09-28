/**
 * Network transport for the normal build: the browser's own fetch, evidence
 * served by the API, and history-based routing.
 *
 * The offline demonstration build aliases this module to `transport.demo.ts`
 * (see vite.config.ts), which swaps in the in-browser backend, embedded
 * evidence and hash-based routing. No other file changes between the builds.
 */
import { BrowserRouter } from 'react-router-dom';

export const IS_DEMO = false;

export const transport: typeof fetch = (input, init) => fetch(input, init);

/** In the demo build this returns an embedded data URL instead. */
export const assetUrl = (_storedName: string): string | null => null;

/**
 * The demo build sets this so report exports can be produced in the browser.
 * When it is null the UI links straight to the server's export endpoints.
 */
export const exportReport: ((path: string, params: Record<string, unknown>) => void) | null = null;

export const AppRouter = BrowserRouter;
