/**
 * Client-side report export for the offline demonstration build.
 *
 * The served application generates CSV, Excel and PDF on the server. With no
 * server, CSV can still be produced honestly in the browser from the same rows
 * the preview shows; Excel and PDF cannot, and the UI says so rather than
 * offering a link that would go nowhere.
 */
import { handle } from './router';

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n/g, ' ');
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (rows: Record<string, unknown>[]): string => {
  if (!rows.length) return '﻿No data for these filters\r\n';
  const columns = Object.keys(rows[0]!);
  const header = columns.map((c) => csvCell(c.replace(/_/g, ' '))).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c])).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
};

const save = (fileName: string, contents: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/**
 * Exports a report as CSV using the in-browser data. `path` is the same path
 * the served application would call, e.g. `/reports/pending`.
 */
export function exportReportCsv(path: string, params: Record<string, unknown>, token: string | null): void {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'format' || key === 'access_token') continue;
    query.set(key, String(value));
  }
  const cleanPath = path.startsWith('/api') ? path.slice(4) : path;
  const payload = handle({ method: 'GET', path: cleanPath, query, token, body: undefined }) as {
    title?: string;
    data?: Record<string, unknown>[];
    observations?: Record<string, unknown>[];
  };
  const rows = payload.data ?? payload.observations ?? [];
  const name = `${cleanPath.split('/').filter(Boolean).join('-')}-${stamp()}.csv`;
  save(name, toCsv(rows), 'text/csv;charset=utf-8');
}
