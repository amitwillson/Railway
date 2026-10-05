import { useState } from 'react';
import ChartFrame from './ChartFrame';
import { series } from './theme';
import { number } from '../../lib/format';

export interface BarDatum {
  label: string;
  value: number;
  sub?: string;
  href?: string;
}

/**
 * Horizontal bars for "magnitude by category" - one series, so no legend.
 * Bars are capped at 18px, grow from a single baseline with a 4px rounded
 * data-end, and every value is direct-labelled at the tip.
 */
export function BarChart({
  data, title, subtitle, color, max, onSelect, unit = '',
}: {
  data: BarDatum[]; title?: string; subtitle?: string; color?: string;
  max?: number; onSelect?: (datum: BarDatum) => void; unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const tone = color ?? series(0);
  const peak = Math.max(max ?? 0, ...data.map((d) => d.value), 1);

  if (data.length === 0) {
    return <ChartFrame title={title} subtitle={subtitle}><div className="chart__empty">No data for this selection</div></ChartFrame>;
  }

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={{ columns: ['Item', 'Count'], rows: data.map((d) => [d.label, d.value]) }}
    >
      <div className="stack" style={{ '--gap': '9px' } as React.CSSProperties}>
        {data.map((datum, index) => {
          const pct = (datum.value / peak) * 100;
          return (
            <div
              key={`${datum.label}-${index}`}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(datum)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
              <div className="row" style={{ gap: 8, marginBottom: 3 }}>
                <span className="xsmall truncate" style={{ flex: 1, color: 'var(--ink-2)', fontWeight: 550 }}>
                  {datum.label}
                </span>
                <span className="xsmall mono-num strong">{number(datum.value)}{unit}</span>
              </div>
              <div style={{ height: 10, background: 'var(--surface-3)', borderRadius: 5, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.max(pct, datum.value > 0 ? 3 : 0)}%`,
                    height: '100%',
                    background: tone,
                    borderRadius: '0 4px 4px 0',
                    opacity: hover === null || hover === index ? 1 : 0.55,
                    transition: 'width 0.4s ease, opacity 0.15s ease',
                  }}
                />
              </div>
              {datum.sub && <div className="xsmall muted" style={{ marginTop: 2 }}>{datum.sub}</div>}
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

export interface StackSeries { key: string; label: string; colorIndex?: number; color?: string }

/**
 * Stacked bars for a part-to-whole split across categories (module-wise,
 * department-wise). Segments are separated by a 2px surface gap rather than a
 * stroke, and the total is direct-labelled.
 */
export function StackedBars({
  rows, seriesDef, title, subtitle, onSelect,
}: {
  rows: { label: string; sub?: string; values: Record<string, number> }[];
  seriesDef: StackSeries[];
  title?: string; subtitle?: string;
  onSelect?: (label: string) => void;
}) {
  const colors = seriesDef.map((s, i) => s.color ?? series(s.colorIndex ?? i));
  const totals = rows.map((r) => seriesDef.reduce((sum, s) => sum + (r.values[s.key] ?? 0), 0));
  const peak = Math.max(1, ...totals);

  if (rows.length === 0) {
    return <ChartFrame title={title} subtitle={subtitle}><div className="chart__empty">No data for this selection</div></ChartFrame>;
  }

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={seriesDef.map((s, i) => ({ label: s.label, color: colors[i]! }))}
      table={{
        columns: ['Item', ...seriesDef.map((s) => s.label), 'Total'],
        rows: rows.map((r, i) => [r.label, ...seriesDef.map((s) => r.values[s.key] ?? 0), totals[i] ?? 0]),
      }}
    >
      <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
        {rows.map((row, rowIndex) => (
          <div
            key={row.label}
            onClick={() => onSelect?.(row.label)}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className="xsmall truncate" style={{ flex: 1, color: 'var(--ink-2)', fontWeight: 600 }}>
                {row.label}
              </span>
              <span className="xsmall mono-num strong">{number(totals[rowIndex])}</span>
            </div>
            <div style={{ display: 'flex', height: 14, gap: 2 }}>
              {seriesDef.map((s, i) => {
                const value = row.values[s.key] ?? 0;
                if (value <= 0) return null;
                const width = (value / peak) * 100;
                return (
                  <div
                    key={s.key}
                    title={`${s.label}: ${value}`}
                    style={{
                      width: `${width}%`,
                      background: colors[i],
                      borderRadius: i === 0 ? '3px 0 0 3px' : 0,
                      minWidth: 3,
                      transition: 'width 0.4s ease',
                    }}
                  />
                );
              })}
              {totals[rowIndex] === 0 && (
                <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 3 }} />
              )}
            </div>
            {row.sub && <div className="xsmall muted" style={{ marginTop: 3 }}>{row.sub}</div>}
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

export default BarChart;
