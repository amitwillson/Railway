import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import Icon from '../components/Icon';
import ObservationCard from '../components/ObservationCard';
import { Badge, Card, EmptyState, Loading } from '../components/ui';
import { formatDate, titleCase } from '../lib/format';
import type { Observation } from '../api/types';

interface SearchResult {
  query: string;
  stations: { id: number; code: string; name: string; category: string | null; division_name: string }[];
  trains: { id: number; number: string; name: string; origin: string | null; destination: string | null }[];
  supervisors: { id: number; name: string; designation: string | null; mobile: string | null; employee_id: string; department_name: string; station_name: string | null }[];
  inspections: { id: number; ref_no: string; inspection_type_name: string; module_code: string; station_name: string | null; train_number: string | null; status: string; created_at: string; inspector_name: string }[];
  observations: Observation[];
  totals: Record<string, number>;
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = params.get('q');
    if (!q) {
      setResult(null);
      return;
    }
    setLoading(true);
    api.get<SearchResult>('/search', { q, limit: 8 })
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [params]);

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Search</h1>
        <p>Station, station code, train number, observation ID, inspector, department, supervisor, amenity, unit</p>
      </div>

      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          setParams(term ? { q: term } : {});
        }}
      >
        <input className="input" autoFocus placeholder="Search anything" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="btn" type="submit" aria-label="Search"><Icon name="search" size={17} /></button>
      </form>

      {loading && <Loading />}

      {result && (
        <>
          <div className="row row--wrap" style={{ gap: 6 }}>
            {Object.entries(result.totals).map(([key, value]) => (
              <Badge key={key} tone={value ? 'accent' : 'outline'}>{titleCase(key)}: {value}</Badge>
            ))}
          </div>

          {result.stations.length > 0 && (
            <Card title="Stations" pad={false}>
              {result.stations.map((s) => (
                <Link key={s.id} to={`/stations/${s.id}`} className="login__demo-row" style={{ margin: 10 }}>
                  <Icon name="station" size={17} />
                  <span style={{ flex: 1 }}>
                    <span className="small strong">{s.name} ({s.code})</span>
                    <span className="xsmall muted" style={{ display: 'block' }}>{s.division_name} Division · {s.category}</span>
                  </span>
                  <Icon name="chevron-right" size={15} />
                </Link>
              ))}
            </Card>
          )}

          {result.trains.length > 0 && (
            <Card title="Trains" pad={false}>
              {result.trains.map((t) => (
                <Link key={t.id} to={`/trains/${t.id}`} className="login__demo-row" style={{ margin: 10 }}>
                  <Icon name="train" size={17} />
                  <span style={{ flex: 1 }}>
                    <span className="small strong">{t.number} - {t.name}</span>
                    <span className="xsmall muted" style={{ display: 'block' }}>{t.origin} → {t.destination}</span>
                  </span>
                  <Icon name="chevron-right" size={15} />
                </Link>
              ))}
            </Card>
          )}

          {result.supervisors.length > 0 && (
            <Card title="Supervisors" pad={false}>
              {result.supervisors.map((s) => (
                <div key={s.id} className="login__demo-row" style={{ margin: 10, cursor: 'default' }}>
                  <Icon name="user" size={17} />
                  <span style={{ flex: 1 }}>
                    <span className="small strong">{s.name}</span>
                    <span className="xsmall muted" style={{ display: 'block' }}>
                      {[s.designation, s.department_name, s.station_name, s.mobile].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Link to={`/observations?supervisor_id=${s.id}`} className="badge badge--accent">Observations</Link>
                </div>
              ))}
            </Card>
          )}

          {result.inspections.length > 0 && (
            <Card title="Inspections" pad={false}>
              {result.inspections.map((i) => (
                <Link key={i.id} to={`/inspections/${i.id}`} className="login__demo-row" style={{ margin: 10 }}>
                  <Icon name="clipboard" size={17} />
                  <span style={{ flex: 1 }}>
                    <span className="small strong">{i.ref_no} · {i.inspection_type_name}</span>
                    <span className="xsmall muted" style={{ display: 'block' }}>
                      {[i.station_name, i.train_number, i.inspector_name, formatDate(i.created_at)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Badge tone="outline">{i.module_code}</Badge>
                </Link>
              ))}
            </Card>
          )}

          {result.observations.length > 0 && (
            <div>
              <div className="section-label">Observations</div>
              <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                {result.observations.map((o) => <ObservationCard key={o.id} observation={o} />)}
              </div>
              {result.totals.observations > result.observations.length && (
                <div className="center" style={{ marginTop: 10 }}>
                  <Link to={`/observations?q=${encodeURIComponent(result.query)}`} className="btn btn--ghost btn--sm">
                    See all {result.totals.observations} matching observations
                  </Link>
                </div>
              )}
            </div>
          )}

          {Object.values(result.totals).every((v) => v === 0) && (
            <Card><EmptyState icon="search" title="Nothing matched" text={`No record matches "${result.query}".`} /></Card>
          )}
        </>
      )}
    </div>
  );
}
