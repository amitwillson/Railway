import { useState, type ReactNode } from 'react';

export interface LegendEntry { label: string; color: string; kind?: 'fill' | 'line' }

/**
 * Shared chart chrome: title, legend (always present for two or more series)
 * and a table view, so identity is never carried by colour alone and every
 * value is reachable as text.
 */
export function ChartFrame({
  title, subtitle, legend, table, children, height,
}: {
  title?: ReactNode; subtitle?: ReactNode;
  legend?: LegendEntry[];
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  height?: number;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="chart">
      {(title || table) && (
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            {title && <div className="strong small">{title}</div>}
            {subtitle && <div className="xsmall muted">{subtitle}</div>}
          </div>
          {table && (
            <button className="chart__toggle" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Show chart' : 'Show table'}
            </button>
          )}
        </div>
      )}

      {showTable && table ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>{table.columns.map((c, i) => <th key={c} className={i === 0 ? '' : 'num'}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={ci === 0 ? '' : 'num'}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={height ? { minHeight: height } : undefined}>{children}</div>
      )}

      {!showTable && legend && legend.length > 1 && (
        <div className="chart__legend">
          {legend.map((entry) => (
            <span className="chart__legend-item" key={entry.label}>
              <span
                className={`chart__swatch${entry.kind === 'line' ? ' chart__swatch--line' : ''}`}
                style={{ background: entry.color }}
                aria-hidden="true"
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChartFrame;
