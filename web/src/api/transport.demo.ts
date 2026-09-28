/**
 * Transport for the offline demonstration build: requests are answered by the
 * in-browser backend, evidence comes from embedded data URLs, and routing is
 * hash-based so the single HTML file works from a file:// URL.
 */
import { HashRouter } from 'react-router-dom';
import { demoFetch, demoImage } from '../demo';
import { exportReportCsv } from '../demo/download';
import { getToken } from './client';

export const IS_DEMO = true;

export const transport: typeof fetch = (input, init) => demoFetch(input, init);

export const assetUrl = (storedName: string): string | null => demoImage(storedName);

export const exportReport = (path: string, params: Record<string, unknown>): void =>
  exportReportCsv(path, params, getToken());

export const AppRouter = HashRouter;
