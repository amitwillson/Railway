import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, reportUrl } from '../api/client';
import Icon from '../components/Icon';
import ObservationCard from '../components/ObservationCard';
import { Badge, Card, EmptyState, Loading, StatTile } from '../components/ui';
import { BarChart } from '../components/charts/BarChart';
import { formatDate, number, relativeTime, titleCase } from '../lib/format';
import type { Inspection, Observation, Train } from '../api/types';

export function Trains() {
  const [rows, setRows] = useState<Train[]>([]);
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setLoading(true);
      api.get<{ data: Train[] }>('/history/trains', { q: term || undefined, limit: 60 })
        .then((r) => setRows(r.data))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [term]);

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Train Inspection</h1>
        <p>Train-wise inspection history, searchable by train number or name</p>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="Train number or name"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Link to="/inspections/new" className="btn btn--sm"><Icon name="plus" size={14} /> Inspect</Link>
      </div>

      {loading && rows.length === 0 ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon="train" title="No train matches this search" /></Card>
      ) : (
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {rows.map((t) => (
            <Link key={t.id} to={`/trains/${t.id}`} className="obs" style={{ '--tone': 'var(--mod-amber)' } as React.CSSProperties}>
              <div className="obs__top">
                <span className="strong mono-num">{t.number}</span>
                <span className="strong">{t.name}</span>
                {t.train_type && <Badge tone="outline">{t.train_type}</Badge>}
                {!!t.has_pantry && <Badge tone="outline">Pantry car</Badge>}
                <span className="spacer" />
                <Icon name="chevron-right" size={16} />
              </div>
              <div className="obs__meta">
                <span>{t.origin} → {t.destination}</span>
                <span><b>{t.inspections ?? 0}</b> inspections</span>
                <span><b>{t.observations ?? 0}</b> observations</span>
                {!!t.pending && <span style={{ color: 'var(--critical)' }}><b>{t.pending}</b> pending</span>}
                {t.last_inspected_at && <span>Last inspected {relativeTime(t.last_inspected_at)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface TrainHistory {
  train: Train;
  summary: {
    inspections: number; observations: number; pending: number; overdue: number;
    closed: number; critical: number;
    by_coach: Record<string, number>; by_department: Record<string, number>;
  };
  inspections: Inspection[];
  observations: Observation[];
}

export function TrainDetail() {
  const { id } = useParams();
  const [data, setData] = useState<TrainHistory | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<TrainHistory>(`/history/trains/${id}`).then(setData).catch(() => setData(null));
  }, [id]);

  if (!data) return <Loading label="Loading train history" />;
  const t = data.train;
  const sum = data.summary;

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <Link to="/trains" className="btn btn--ghost btn--sm"><Icon name="chevron-left" size={14} /> Trains</Link>
        <span className="spacer" />
        <a className="btn btn--ghost btn--sm" href={reportUrl('/reports/observations', { train_id: t.id, format: 'xlsx' })}>
          <Icon name="download" size={14} /> Export
        </a>
      </div>

      <Card pad>
        <div className="row row--wrap" style={{ gap: 7 }}>
          <h1 style={{ fontSize: '1.1rem' }}>{t.number} - {t.name}</h1>
          {t.train_type && <Badge tone="outline">{t.train_type}</Badge>}
          {!!t.has_pantry && <Badge tone="outline">Pantry car</Badge>}
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>{t.origin} → {t.destination}</p>
        <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
          <Link to="/inspections/new" className="btn btn--sm"><Icon name="plus" size={14} /> Inspect this train</Link>
          <Link to={`/observations?train_id=${t.id}&open=1`} className="btn btn--ghost btn--sm">Pending observations</Link>
        </div>
      </Card>

      <div className="grid grid--tiles">
        <StatTile label="Inspections" value={number(sum.inspections)} />
        <StatTile label="Observations" value={number(sum.observations)} />
        <StatTile label="Pending" value={number(sum.pending)} />
        <StatTile label="Overdue" value={number(sum.overdue)} tone={sum.overdue ? 'alert' : undefined} />
        <StatTile label="Closed" value={number(sum.closed)} />
        <StatTile label="Critical" value={number(sum.critical)} tone={sum.critical ? 'alert' : undefined} />
      </div>

      <div className="grid grid--wide">
        <Card title="Observations by coach / area">
          <BarChart data={Object.entries(sum.by_coach).map(([label, value]) => ({ label, value }))} />
        </Card>
        <Card title="Observations by department">
          <BarChart data={Object.entries(sum.by_department).map(([label, value]) => ({ label, value }))} />
        </Card>
      </div>

      {data.inspections.length > 0 && (
        <Card title="Inspection register" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Inspection</th><th>Type</th><th>Officer</th><th>Date</th><th className="num">Observations</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.inspections.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/inspections/${i.id}`}>{i.ref_no}</Link></td>
                    <td className="xsmall">{i.inspection_type_name}</td>
                    <td className="xsmall">{i.inspector_name}</td>
                    <td className="xsmall">{formatDate(i.started_at ?? i.created_at)}</td>
                    <td className="num">{i.observation_count}</td>
                    <td className="xsmall">{titleCase(i.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div>
        <div className="section-label">Observations ({data.observations.length})</div>
        {data.observations.length === 0 ? (
          <Card><EmptyState icon="train" title="No observations recorded on this train yet" /></Card>
        ) : (
          <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            {data.observations.map((o) => <ObservationCard key={o.id} observation={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default Trains;
