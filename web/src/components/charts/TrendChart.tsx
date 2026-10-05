import { useMemo, useState } from 'react';
import ChartFrame from './ChartFrame';
import { series } from './theme';
import { formatDate } from '../../lib/format';
import { useMeasure } from '../../lib/useMeasure';

export interface TrendPoint { day: string; raised: number; closed: number }

/**
 * Two-series line chart with a crosshair and tooltip. 2px lines, >=8px end
 * markers with a 2px surface ring, 10% area wash, hairline gridlines, and the
 * endpoints as the only direct labels.
 *
 * The SVG is drawn at the container's measured pixel size rather than being
 * scaled from a fixed viewBox, so strokes stay 2px and the labels stay legible
 * at every width.
 */
export function TrendChart({
  data, title, subtitle, height = 200,
}: { data: TrendPoint[]; title?: string; subtitle?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref: wrapRef, width } = useMeasure<HTMLDivElement>();

  const geometry = useMemo(() => {
    const pad = { top: 14, right: 16, bottom: 22, left: 30 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const peak = Math.max(1, ...data.flatMap((d) => [d.raised, d.closed]));
    const ceiling = Math.ceil(peak / 2) * 2;
    const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => pad.top + innerH - (v / (ceiling || 1)) * innerH;
    const line = (key: 'raised' | 'closed') =>
      data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
    const area = (key: 'raised' | 'closed') =>
      `${line(key)} L${x(data.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;
    return { pad, innerW, innerH, ceiling, x, y, line, area };
  }, [data, height, width]);

  if (data.length === 0) {
    return <ChartFrame title={title} subtitle={subtitle}><div className="chart__empty">No activity in this period</div></ChartFrame>;
  }

  const raisedColor = series(0);
  const closedColor = series(2);
  const { pad, innerW, innerH, ceiling, x, y, line, area } = geometry;
  const ticks = [0, ceiling / 2, ceiling];
  const last = data.length - 1;
  const point = hover != null ? data[hover] : null;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={[
        { label: 'Observations raised', color: raisedColor, kind: 'line' },
        { label: 'Observations closed', color: closedColor, kind: 'line' },
      ]}
      table={{
        columns: ['Date', 'Raised', 'Closed'],
        rows: data.map((d) => [formatDate(d.day), d.raised, d.closed]),
      }}
    >
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height, display: 'block' }}
          role="img"
          aria-label={`${title ?? 'Trend'}: observations raised and closed per day`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relative = event.clientX - rect.left;
            const ratio = (relative - pad.left) / innerW;
            const index = Math.round(ratio * (data.length - 1));
            setHover(Math.max(0, Math.min(data.length - 1, index)));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left} x2={pad.left + innerW} y1={y(tick)} y2={y(tick)}
                stroke="var(--grid)" strokeWidth="1"
              />
              <text x={pad.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize="9" fill="var(--muted)">
                {tick}
              </text>
            </g>
          ))}

          <path d={area('raised')} fill={raisedColor} opacity="0.1" />
          <path d={line('raised')} fill="none" stroke={raisedColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={line('closed')} fill="none" stroke={closedColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {hover != null && (
            <line
              x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH}
              stroke="var(--line-strong)" strokeWidth="1"
            />
          )}
          {hover != null && data[hover] && (
            <>
              <circle cx={x(hover)} cy={y(data[hover]!.raised)} r="4.5" fill={raisedColor} stroke="var(--surface)" strokeWidth="2" />
              <circle cx={x(hover)} cy={y(data[hover]!.closed)} r="4.5" fill={closedColor} stroke="var(--surface)" strokeWidth="2" />
            </>
          )}

          <circle cx={x(last)} cy={y(data[last]!.raised)} r="4" fill={raisedColor} stroke="var(--surface)" strokeWidth="2" />
          <circle cx={x(last)} cy={y(data[last]!.closed)} r="4" fill={closedColor} stroke="var(--surface)" strokeWidth="2" />

          <text x={pad.left} y={height - 6} fontSize="9" fill="var(--muted)">{formatDate(data[0]!.day)}</text>
          <text x={pad.left + innerW} y={height - 6} fontSize="9" fill="var(--muted)" textAnchor="end">
            {formatDate(data[last]!.day)}
          </text>
        </svg>

        {point && (
          <div
            className="chart__tip"
            style={{ left: `${((x(hover!) / Math.max(width, 1)) * 100).toFixed(2)}%`, top: 4 }}
          >
            <div className="chart__tip-title">{formatDate(point.day)}</div>
            <div className="chart__tip-row">
              <span><span className="chart__swatch chart__swatch--line" style={{ background: raisedColor, display: 'inline-block', marginRight: 5 }} />Raised</span>
              <b>{point.raised}</b>
            </div>
            <div className="chart__tip-row">
              <span><span className="chart__swatch chart__swatch--line" style={{ background: closedColor, display: 'inline-block', marginRight: 5 }} />Closed</span>
              <b>{point.closed}</b>
            </div>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

/** 12-point sparkline for a stat tile. */
export function Sparkline({ values, color, width = 90, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const peak = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - (v / peak) * (height - 3) - 1.5).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke={color ?? series(0)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default TrendChart;
