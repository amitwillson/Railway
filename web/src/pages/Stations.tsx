import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Icon from '../components/Icon';
import { Badge, Card, EmptyState, Loading } from '../components/ui';
import { relativeTime } from '../lib/format';

interface StationRow {
  station_id: number; station_name: string; station_code: string; division_name: string;
  section?: string | null; section_name?: string | null;
  observations: number; pending: number; overdue: number; closed: number; repeated: number;
  inspections: number; last_observation_at: string;
  passenger_amenities: number; commercial: number; safe_running: number;
}

export default function Stations() {
  const [rows, setRows] = useState<StationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');

  useEffect(() => {
    api.get<{ data: StationRow[] }>('/dashboard/stations', { limit: 100 })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter((r) =>
    `${r.station_name} ${r.station_code} ${r.division_name} ${r.section ?? ''} ${r.section_name ?? ''}`
      .toLowerCase()
      .includes(term.toLowerCase())
  );

  if (loading) return <Loading label="Loading station history" />;

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Station History</h1>
        <p>Complete inspection record of every station, with repeated deficiencies</p>
      </div>

      <input
        className="input"
        placeholder="Search station name, code, section or division"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="station" title="No station has been inspected yet" text="Station history appears here once observations are recorded." />
        </Card>
      ) : (
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {filtered.map((s) => (
            <Link key={s.station_id} to={`/stations/${s.station_id}`} className="obs" style={{ '--tone': 'var(--accent)' } as React.CSSProperties}>
              <div className="obs__top">
                <span className="strong">{s.station_name}</span>
                <Badge tone="outline">{s.station_code}</Badge>
                <Badge tone="accent">{s.division_name} Div</Badge>
                {s.section && <Badge tone="outline">{s.section}</Badge>}
                {s.overdue > 0 && <Badge tone="critical">{s.overdue} overdue</Badge>}
                {s.repeated > 0 && <Badge tone="warning"><Icon name="repeat" size={11} /> {s.repeated} repeated</Badge>}
                <span className="spacer" />
                <Icon name="chevron-right" size={16} />
              </div>
              <div className="row row--wrap" style={{ gap: 14, marginTop: 6 }}>
                {[
                  ['Inspections', s.inspections],
                  ['Observations', s.observations],
                  ['Pending', s.pending],
                  ['Closed', s.closed],
                ].map(([label, value]) => (
                  <span key={String(label)} className="xsmall">
                    <b className="mono-num" style={{ fontSize: '0.95rem' }}>{value}</b> <span className="muted">{label}</span>
                  </span>
                ))}
              </div>
              <div className="obs__meta" style={{ marginTop: 6 }}>
                <span>Amenities <b>{s.passenger_amenities}</b></span>
                <span>Commercial <b>{s.commercial}</b></span>
                <span>Safe running <b>{s.safe_running}</b></span>
                {s.last_observation_at && <span>Last observation {relativeTime(s.last_observation_at)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
