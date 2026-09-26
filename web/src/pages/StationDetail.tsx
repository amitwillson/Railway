import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, reportUrl } from '../api/client';
import Icon from '../components/Icon';
import ObservationCard from '../components/ObservationCard';
import { Badge, Card, EmptyState, Loading, StatTile, Tabs } from '../components/ui';
import { BarChart } from '../components/charts/BarChart';
import { formatDate, number, titleCase } from '../lib/format';
import type { Inspection, Observation, Station } from '../api/types';

interface HistoryPayload {
  station: Station & { zone_name: string; platforms: number };
  window_days: number;
  summary: {
    inspections: number; observations: number; pending: number; overdue: number;
    closed: number; repeated: number; critical: number;
    by_module: Record<string, number>; by_department: Record<string, number>;
    by_unit: Record<string, number>; avg_closure_days: number | null;
  };
  repeated_deficiencies: {
    unit_name: string; item_name: string; module_code: string; occurrences: number;
    first_seen: string; last_seen: string; open: number; refs: string[];
  }[];
  inspections: Inspection[];
  observations: Observation[];
}

interface ComparePayload {
  available_inspections: Inspection[];
  current: Inspection;
  previous: Inspection | null;
  carried_forward: { current: Observation; previous: Observation }[];
  newly_observed: Observation[];
  rectified_since_last: Observation[];
  still_open_from_previous: Observation[];
}

type Tab = 'summary' | 'observations' | 'inspections' | 'compare';

export default function StationDetail() {
  const { id } = useParams();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [days, setDays] = useState(365);

  useEffect(() => {
    if (!id) return;
    api.get<HistoryPayload>(`/history/stations/${id}`, { days })
      .then(setData)
      .catch(() => setData(null));
  }, [id, days]);

  useEffect(() => {
    if (!id || tab !== 'compare' || compare) return;
    api.get<ComparePayload>(`/history/stations/${id}/compare`).then(setCompare).catch(() => setCompare(null));
  }, [id, tab, compare]);

  if (!data) return <Loading label="Loading station history" />;
  const s = data.station;
  const sum = data.summary;

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <Link to="/stations" className="btn btn--ghost btn--sm"><Icon name="chevron-left" size={14} /> Stations</Link>
        <span className="spacer" />
        <a className="btn btn--ghost btn--sm" href={reportUrl('/reports/station-wise', { station_id: s.id, format: 'pdf' })} target="_blank" rel="noreferrer">
          <Icon name="download" size={14} /> Station report
        </a>
      </div>

      <Card pad>
        <div className="row row--wrap" style={{ gap: 7 }}>
          <h1 style={{ fontSize: '1.1rem' }}>{s.name}</h1>
          <Badge tone="outline">{s.code}</Badge>
          <Badge tone="accent">{s.division_name} Division</Badge>
          <Badge tone="outline">{s.zone_name}</Badge>
          {s.category && <Badge tone="outline">{s.category}</Badge>}
          {s.station_type && <Badge tone="outline">{s.station_type}</Badge>}
          {!!s.platforms && <Badge tone="outline">{s.platforms} platforms</Badge>}
        </div>
        <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
          <Link to={`/inspections/new`} className="btn btn--sm"><Icon name="plus" size={14} /> Inspect this station</Link>
          <Link to={`/observations?station_id=${s.id}&open=1`} className="btn btn--ghost btn--sm">Pending observations</Link>
          <div className="select-wrap" style={{ marginLeft: 'auto', minWidth: 150 }}>
            <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ minHeight: 34 }}>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last 12 months</option>
              <option value={3650}>All time</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="grid grid--tiles">
        <StatTile label="Inspections" value={number(sum.inspections)} />
        <StatTile label="Observations" value={number(sum.observations)} />
        <StatTile label="Pending" value={number(sum.pending)} to={`/observations?station_id=${s.id}&open=1`} />
        <StatTile label="Overdue" value={number(sum.overdue)} tone={sum.overdue ? 'alert' : undefined} to={`/observations?station_id=${s.id}&overdue=1`} />
        <StatTile label="Closed" value={number(sum.closed)} />
        <StatTile label="Repeated" value={number(sum.repeated)} tone={sum.repeated ? 'warn' : undefined} />
        <StatTile label="Avg closure" value={sum.avg_closure_days ?? '-'} foot="days" />
      </div>

      <Tabs
        tabs={[
          { key: 'summary', label: 'Summary' },
          { key: 'observations', label: 'Observations', count: data.observations.length },
          { key: 'inspections', label: 'Inspections', count: data.inspections.length },
          { key: 'compare', label: 'Compare inspections' },
        ]}
        value={tab}
        onChange={(key) => setTab(key as Tab)}
      />

      {tab === 'summary' && (
        <div className="grid grid--wide">
          <Card title="Observations by unit / area">
            <BarChart
              data={Object.entries(sum.by_unit).slice(0, 12).map(([label, value]) => ({ label, value }))}
            />
          </Card>
          <Card title="Observations by department">
            <BarChart
              data={Object.entries(sum.by_department).map(([label, value]) => ({ label, value }))}
            />
          </Card>
          <Card title="Module split">
            <BarChart data={Object.entries(sum.by_module).map(([label, value]) => ({ label, value }))} />
          </Card>
          <Card title="Repeated deficiencies" icon="repeat" pad={false}>
            {data.repeated_deficiencies.length === 0 ? (
              <div className="card__body"><p className="small muted">No deficiency has recurred at this station in this period.</p></div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Unit</th><th>Item</th><th className="num">Times</th><th className="num">Open</th><th>Last seen</th></tr>
                  </thead>
                  <tbody>
                    {data.repeated_deficiencies.map((r, i) => (
                      <tr key={i}>
                        <td>{r.unit_name}</td>
                        <td className="strong">{r.item_name}</td>
                        <td className="num strong">{r.occurrences}</td>
                        <td className="num">{r.open}</td>
                        <td className="xsmall">{formatDate(r.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'observations' && (
        data.observations.length === 0 ? (
          <Card><EmptyState icon="list" title="No observations in this period" /></Card>
        ) : (
          <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            {data.observations.map((o) => <ObservationCard key={o.id} observation={o} />)}
          </div>
        )
      )}

      {tab === 'inspections' && (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Inspection</th><th>Type</th><th>Module</th><th>Officer</th><th>Date</th><th className="num">Observations</th><th className="num">Open</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.inspections.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/inspections/${i.id}`}>{i.ref_no}</Link></td>
                    <td className="xsmall">{i.inspection_type_name}</td>
                    <td><Badge tone="outline">{i.module_code}</Badge></td>
                    <td className="xsmall">{i.inspector_name}</td>
                    <td className="xsmall">{formatDate(i.started_at ?? i.created_at)}</td>
                    <td className="num">{i.observation_count}</td>
                    <td className="num">{i.open_count}</td>
                    <td className="xsmall">{titleCase(i.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'compare' && (
        !compare ? (
          <Loading label="Comparing inspections" />
        ) : (
          <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
            <Card title="Comparison" subtitle={`${compare.current.ref_no} against ${compare.previous?.ref_no ?? 'no earlier inspection'}`}>
              <div className="grid grid--4">
                <StatTile label="Carried forward" value={compare.carried_forward.length} tone={compare.carried_forward.length ? 'warn' : undefined} />
                <StatTile label="Newly observed" value={compare.newly_observed.length} />
                <StatTile label="Rectified since last" value={compare.rectified_since_last.length} />
                <StatTile label="Still open from previous" value={compare.still_open_from_previous.length} tone={compare.still_open_from_previous.length ? 'alert' : undefined} />
              </div>
            </Card>

            {compare.carried_forward.length > 0 && (
              <Card title="Carried forward" subtitle="Same unit and item observed again in the current inspection" icon="repeat" pad={false}>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Unit</th><th>Item</th><th>Previous</th><th>Current</th><th>Current status</th></tr></thead>
                    <tbody>
                      {compare.carried_forward.map((pair) => (
                        <tr key={pair.current.id}>
                          <td>{pair.current.unit_name}</td>
                          <td className="strong">{pair.current.item_name}</td>
                          <td><Link to={`/observations/${pair.previous.id}`}>{pair.previous.ref_no}</Link></td>
                          <td><Link to={`/observations/${pair.current.id}`}>{pair.current.ref_no}</Link></td>
                          <td className="xsmall">{titleCase(pair.current.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {compare.still_open_from_previous.length > 0 && (
              <Card title="Still open from the previous inspection" pad={false}>
                <div className="stack card__body" style={{ '--gap': '10px' } as React.CSSProperties}>
                  {compare.still_open_from_previous.map((o) => <ObservationCard key={o.id} observation={o} />)}
                </div>
              </Card>
            )}
          </div>
        )
      )}
    </div>
  );
}
