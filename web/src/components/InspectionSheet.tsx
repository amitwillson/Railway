import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { Badge, Banner, Button, Card, SeverityBadge } from './ui';
import { formatDate } from '../lib/format';
import type {
  AreaResult, InspectionArea, InspectionCoverage, InspectionItem, ItemResult,
  PreviousFinding, PreviousItem,
} from '../api/types';

/**
 * The inspection sheet, as the inspector works it.
 *
 * A commercial inspector attends to many areas - often every area - of a station
 * in one visit, so the sheet is the spine of the screen: every area of the
 * station, each starting at "not inspected", worked through one by one. Marking
 * an item in order is one tap; a deficiency opens the observation form with the
 * area and the item already filled in.
 *
 * The distinction the sheet exists to keep is between an area found in order and
 * an area nobody looked at. Both are recorded; neither is guessed.
 */

export const AREA_RESULT_LABEL: Record<AreaResult, string> = {
  satisfactory: 'Found in order',
  deficiencies: 'Deficiencies noticed',
  not_inspected: 'Not inspected',
  not_available: 'Not available',
};

const AREA_TONE: Record<AreaResult, string> = {
  satisfactory: 'good',
  deficiencies: 'warning',
  not_inspected: 'outline',
  not_available: 'neutral',
};

export const FINDING_LABEL: Record<PreviousFinding, string> = {
  complied: 'Complied',
  partially_complied: 'Partly complied',
  not_complied: 'Not complied',
  dropped: 'Dropped',
};

const FINDING_TONE: Record<PreviousFinding, string> = {
  complied: 'good',
  partially_complied: 'warning',
  not_complied: 'critical',
  dropped: 'neutral',
};

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How much of the place this visit has covered. It leads the screen because it is
 * the headline of an inspection - a count of deficiencies is not.
 */
export function CoverageStrip({ coverage, compact }: { coverage: InspectionCoverage; compact?: boolean }) {
  const denominator = coverage.areas_on_sheet - coverage.areas_not_available;
  const pct = coverage.coverage_pct ?? 0;
  const cells: [string, number | string][] = compact
    ? [
        ['Attended to', `${coverage.areas_covered}/${denominator}`],
        ['In order', coverage.areas_satisfactory],
        ['Deficiencies', coverage.areas_with_deficiencies],
        ['Items checked', coverage.items_checked],
      ]
    : [
        ['On sheet', coverage.areas_on_sheet],
        ['Attended to', coverage.areas_covered],
        ['In order', coverage.areas_satisfactory],
        ['Deficiencies', coverage.areas_with_deficiencies],
        ['Not inspected', coverage.areas_not_inspected],
        ['Items checked', coverage.items_checked],
      ];
  return (
    <div className="coverage">
      <div className="coverage__bar" aria-hidden="true">
        <span className="coverage__fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="coverage__cells">
        {cells.map(([label, value]) => (
          <div className="coverage__cell" key={label}>
            <b className="mono-num">{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="xsmall muted coverage__note">
        {denominator > 0
          ? `${pct}% of the areas on this sheet have been attended to`
          : 'No area is on the sheet yet'}
        {coverage.areas_not_available > 0 && ` · ${coverage.areas_not_available} not available here`}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Part I - the previous inspection                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the last inspection of this place left outstanding. Every real inspection
 * opens by walking this list, so it sits above the sheet rather than in a report
 * written afterwards.
 */
export function PreviousReview({
  previousRef, items, onReview, busyId, readOnly,
}: {
  previousRef: string | null;
  items: PreviousItem[];
  onReview?: (item: PreviousItem, finding: PreviousFinding, remarks: string) => void;
  busyId?: number | null;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [remarks, setRemarks] = useState('');
  const reviewed = items.filter((i) => i.review).length;

  if (!previousRef) {
    return (
      <Card title="Part I · Previous inspection" icon="clock">
        <p className="small muted" style={{ margin: 0 }}>
          No previous inspection of this location is on record, so there is nothing to carry forward.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Part I · Previous inspection"
      subtitle={`${previousRef} left ${items.length} item${items.length === 1 ? '' : 's'} outstanding · ${reviewed} reviewed`}
      icon="clock"
      pad={false}
    >
      {items.length === 0 ? (
        <p className="small muted" style={{ padding: '0 14px 14px' }}>
          Nothing was left outstanding by the previous inspection.
        </p>
      ) : (
        <div>
          {items.map((item) => (
            <div key={item.id} className="sheet-row">
              <div className="row row--wrap" style={{ gap: 6 }}>
                <Link to={`/observations/${item.id}`} className="obs__ref">{item.ref_no}</Link>
                <SeverityBadge name={item.severity_name} />
                {item.review ? (
                  <Badge tone={FINDING_TONE[item.review.finding]}>{FINDING_LABEL[item.review.finding]}</Badge>
                ) : (
                  <Badge tone="outline">Not reviewed</Badge>
                )}
                {item.is_overdue ? <Badge tone="critical">Overdue</Badge> : null}
              </div>
              <div className="xsmall muted" style={{ marginTop: 2 }}>
                {[item.unit_name, item.item_name, item.department_name].filter(Boolean).join(' · ')}
                {item.tdc ? ` · TDC ${formatDate(item.tdc)}` : ''}
              </div>
              <div className="small clamp-2" style={{ marginTop: 3 }}>{item.observation}</div>
              {item.review?.remarks && (
                <div className="xsmall muted" style={{ marginTop: 3, fontStyle: 'italic' }}>
                  {item.review.remarks}
                </div>
              )}

              {!readOnly && onReview && (
                open === item.id ? (
                  <div style={{ marginTop: 8 }}>
                    <input
                      className="input"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Remarks (optional)"
                      aria-label={`Remarks for ${item.ref_no}`}
                    />
                    <div className="chips" style={{ marginTop: 8 }}>
                      {(Object.keys(FINDING_LABEL) as PreviousFinding[]).map((finding) => (
                        <button
                          key={finding}
                          type="button"
                          className="chip"
                          disabled={busyId === item.id}
                          onClick={() => {
                            onReview(item, finding, remarks);
                            setOpen(null);
                            setRemarks('');
                          }}
                        >
                          {FINDING_LABEL[finding]}
                        </button>
                      ))}
                      <button type="button" className="chip" onClick={() => setOpen(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="check"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setOpen(item.id);
                      setRemarks(item.review?.remarks ?? '');
                    }}
                  >
                    {item.review ? 'Change the finding' : 'Record the position'}
                  </Button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Part II - the areas                                                        */
/* -------------------------------------------------------------------------- */

export interface AreaSheetProps {
  areas: InspectionArea[];
  openAreaId: number | null;
  onOpenArea: (areaId: number | null) => void;
  onAreaResult: (area: InspectionArea, result: AreaResult) => void;
  onItemResult: (area: InspectionArea, item: InspectionItem, result: ItemResult) => void;
  onRecordDeficiency: (area: InspectionArea, item: InspectionItem | null) => void;
  busy?: boolean;
  readOnly?: boolean;
  availableAreas?: { id: number; name: string; kind: string | null }[];
  onAddArea?: (unitId: number) => void;
}

/**
 * Every area of the station, with what has been found in each. Tapping an area
 * opens its checklist; each item is one tap to mark in order, or opens the
 * observation form if something is wrong.
 */
export function AreaSheet({
  areas, openAreaId, onOpenArea, onAreaResult, onItemResult, onRecordDeficiency,
  busy, readOnly, availableAreas = [], onAddArea,
}: AreaSheetProps) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <Card
      title={`Part II · Areas (${areas.filter((a) => a.result !== 'not_inspected').length} of ${areas.length} attended to)`}
      subtitle="One inspection, every area of the station. Tap an area to work through it."
      icon="list"
      pad={false}
      action={
        availableAreas.length > 0 && onAddArea && !readOnly ? (
          <Button size="sm" variant="quiet" icon="plus" onClick={() => setShowAdd((v) => !v)}>
            Add an area
          </Button>
        ) : undefined
      }
    >
      {showAdd && availableAreas.length > 0 && onAddArea && (
        <div className="chips" style={{ padding: '0 14px 10px' }}>
          {availableAreas.map((u) => (
            <button
              key={u.id}
              type="button"
              className="chip"
              onClick={() => {
                onAddArea(u.id);
                setShowAdd(false);
              }}
            >
              <Icon name="plus" size={12} /> {u.name}
            </button>
          ))}
        </div>
      )}

      <div>
        {areas.map((area) => {
          const open = openAreaId === area.id;
          const recorded = area.item_results ?? [];
          const found = area.observations ?? [];
          return (
            <div key={area.id} className={`sheet-area${open ? ' sheet-area--open' : ''}`}>
              <button
                type="button"
                className="sheet-area__head"
                aria-expanded={open}
                onClick={() => onOpenArea(open ? null : area.id)}
              >
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                <span className="sheet-area__name">{area.unit_name}</span>
                <Badge tone={AREA_TONE[area.result]}>{AREA_RESULT_LABEL[area.result]}</Badge>
                {recorded.length > 0 && (
                  <span className="xsmall muted">
                    {recorded.filter((r) => r.result === 'ok').length}/{recorded.length} in order
                  </span>
                )}
                {found.length > 0 && <Badge tone="critical">{found.length}</Badge>}
              </button>

              {open && (
                <div className="sheet-area__body">
                  {/* What has already been recorded here */}
                  {found.length > 0 && (
                    <div className="stack" style={{ '--gap': '5px', marginBottom: 10 } as React.CSSProperties}>
                      {found.map((o) => (
                        <div key={o.id} className="row row--wrap xsmall" style={{ gap: 6 }}>
                          <Link to={`/observations/${o.id}`} className="obs__ref">{o.ref_no}</Link>
                          <SeverityBadge name={o.severity_name} />
                          <span className="truncate">{o.item_name ?? ''} — {o.observation}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* The checklist for this area. A station carries two hundred
                      inspection items, so the groups stay shut until the inspector
                      opens the one they are working through. */}
                  {(area.catalogue ?? []).map((group) => {
                    const done = recorded.filter((r) =>
                      group.items.some((i) => i.id === r.item_id)
                    );
                    return (
                    <details key={group.group_id} className="sheet-group" open={done.length > 0}>
                      <summary>
                        <span className="sheet-group__name">{group.group_name}</span>
                        <span className="xsmall muted">
                          {done.length > 0 ? `${done.length}/${group.items.length} recorded` : `${group.items.length} items`}
                        </span>
                      </summary>
                      {group.items.map((item) => {
                        const result = recorded.find((r) => r.item_id === item.id);
                        return (
                          <div className="sheet-item" key={item.id}>
                            <span className="sheet-item__name">
                              {item.name}
                              {result && (
                                <Badge tone={result.result === 'ok' ? 'good' : result.result === 'deficient' ? 'critical' : 'neutral'}>
                                  {result.result === 'ok' ? 'In order' : result.result === 'deficient' ? 'Deficient' : 'N/A'}
                                </Badge>
                              )}
                            </span>
                            {!readOnly && (
                              <span className="sheet-item__actions">
                                <button
                                  type="button"
                                  className={`chip chip--xs${result?.result === 'ok' ? ' chip--on' : ''}`}
                                  disabled={busy}
                                  title={`${item.name}: checked and found in order`}
                                  onClick={() => onItemResult(area, item, 'ok')}
                                >
                                  <Icon name="check" size={11} /> In order
                                </button>
                                <button
                                  type="button"
                                  className="chip chip--xs"
                                  disabled={busy}
                                  title={`${item.name}: record a deficiency`}
                                  onClick={() => onRecordDeficiency(area, item)}
                                >
                                  <Icon name="alert" size={11} /> Deficiency
                                </button>
                                <button
                                  type="button"
                                  className={`chip chip--xs${result?.result === 'not_applicable' ? ' chip--on' : ''}`}
                                  disabled={busy}
                                  title={`${item.name}: does not apply here`}
                                  onClick={() => onItemResult(area, item, 'not_applicable')}
                                >
                                  N/A
                                </button>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </details>
                    );
                  })}

                  {!readOnly && (
                    <div className="row row--wrap" style={{ gap: 8, marginTop: 10 }}>
                      <Button size="sm" variant="quiet" icon="check" disabled={busy}
                        onClick={() => onAreaResult(area, 'satisfactory')}>
                        Whole area in order
                      </Button>
                      <Button size="sm" variant="quiet" disabled={busy}
                        onClick={() => onAreaResult(area, 'not_available')}>
                        Not available here
                      </Button>
                      <Button size="sm" variant="quiet" icon="edit" disabled={busy}
                        onClick={() => onRecordDeficiency(area, null)}>
                        Other deficiency
                      </Button>
                    </div>
                  )}
                  {area.remarks && <div className="xsmall muted" style={{ marginTop: 8 }}>{area.remarks}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** A read-only rendering of the sheet, for the report and the inspection page. */
export function AreaSummary({ areas }: { areas: InspectionArea[] }) {
  if (areas.length === 0) {
    return (
      <Banner tone="info">
        No area sheet was opened for this inspection, so there is no record of what was covered.
      </Banner>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Area</th><th>Result</th>
            <th className="num">Checked</th><th className="num">In order</th><th className="num">Deficiencies</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => {
            const items = area.items ?? area.item_results ?? [];
            const found = area.observations ?? [];
            return (
              <tr key={area.id}>
                <td>{area.unit_name}</td>
                <td><Badge tone={AREA_TONE[area.result]}>{AREA_RESULT_LABEL[area.result]}</Badge></td>
                <td className="num mono-num">{items.length}</td>
                <td className="num mono-num">{items.filter((r) => r.result === 'ok').length}</td>
                <td className="num mono-num">{found.length}</td>
                <td className="small">
                  {area.remarks
                    ?? (found.length
                      ? found.map((o) => o.ref_no).join(', ')
                      : area.result === 'satisfactory'
                        ? 'Nothing to report'
                        : '—')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
