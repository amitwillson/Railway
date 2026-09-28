/**
 * Chart palette.
 *
 * The categorical slots are the validated default order (blue, orange, aqua),
 * checked with the data-viz validator against this application's own surfaces:
 *   light surface #ffffff - worst adjacent CVD dE 9.2, normal-vision dE 27.6
 *   dark  surface #121d24 - worst adjacent CVD dE 9.4, normal-vision dE 26.5
 * Aqua sits below 3:1 on the light surface, so every chart that uses it ships
 * direct value labels and a table view (the "relief" rule).
 *
 * Only the first three slots are used anywhere: past three series a chart is
 * faceted or folded into "Other" rather than reaching for a fourth hue.
 */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70'] as const;

export type SeriesIndex = 0 | 1 | 2;

/** Sequential blue ramp (light -> dark) for single-measure magnitude. */
export const SEQ_LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
export const SEQ_DARK = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7'];

export function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function series(index: number, dark = isDark()): string {
  const set = dark ? SERIES_DARK : SERIES_LIGHT;
  return set[Math.min(index, set.length - 1)] ?? set[0];
}

/** Status roles - reserved, never reused as a series colour. */
export const STATUS_COLOR = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export const CHART_INK = {
  text: 'var(--ink)',
  secondary: 'var(--ink-2)',
  muted: 'var(--muted)',
  grid: 'var(--grid)',
  axis: 'var(--line-strong)',
  surface: 'var(--surface)',
};
