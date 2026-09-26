import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import Icon, { type IconName } from '../components/Icon';
import ObservationCard from '../components/ObservationCard';
import { Badge, Card, EmptyState, Loading, StatTile } from '../components/ui';
import { moduleTone, number } from '../lib/format';
import type { InspectionItem, Observation, Paged } from '../api/types';

interface ModuleStats { total: number; open: number; overdue: number; closed: number; critical: number; critical_open: number; repeated: number; compliance_submitted: number }

const ICONS: Record<string, IconName> = { PA: 'water', CI: 'clipboard', SR: 'shield' };

export default function ModuleLanding() {
  const { code = 'PA' } = useParams();
  const { masters } = useAuth();
  const [stats, setStats] = useState<ModuleStats | null>(null);
  const [recent, setRecent] = useState<Observation[]>([]);
  const [groups, setGroups] = useState<{ group_id: number; group_name: string; items: InspectionItem[] }[]>([]);
  const [loading, setLoading] = useState(true);

  const module = (masters?.modules ?? []).find((m) => m.code === code);

  useEffect(() => {
    if (!module) return;
    setLoading(true);
    Promise.all([
      api.get<{ data: (ModuleStats & { module: { id: number } })[] }>('/dashboard/modules'),
      api.get<Paged<Observation>>('/observations', { module_id: module.id, page_size: 8, sort: 'newest' }),
      api.get<{ groups: { group_id: number; group_name: string; items: InspectionItem[] }[] }>('/masters/items', {
        module_code: code, limit: 500,
      }),
    ])
      .then(([m, o, i]) => {
        setStats(m.data.find((row) => row.module.id === module.id) ?? null);
        setRecent(o.data);
        setGroups(i.groups);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [module, code]);

  if (!module) return <Loading label="Loading module" />;
  const tone = moduleTone(module.accent);

  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <div
        className="card card--pad"
        style={{
          borderLeft: `5px solid var(--mod-${tone})`,
          background: `var(--mod-${tone}-soft)`,
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <span
            style={{
              width: 44, height: 44, borderRadius: 12, flex: 'none',
              background: 'var(--surface)', color: `var(--mod-${tone})`,
              display: 'grid', placeItems: 'center',
            }}
          >
            <Icon name={ICONS[code] ?? 'clipboard'} size={22} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: '1.1rem' }}>{module.name}</h1>
            <p className="small" style={{ color: 'var(--ink-2)' }}>{module.tagline}</p>
          </div>
        </div>
        {module.description && <p className="small" style={{ marginTop: 10, color: 'var(--ink-2)' }}>{module.description}</p>}
        <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
          <Link to={`/inspections/new?module=${code}`} className="btn btn--sm">
            <Icon name="plus" size={14} /> Start {module.name} inspection
          </Link>
          <Link to={`/observations?module_id=${module.id}&open=1`} className="btn btn--ghost btn--sm">
            View pending observations
          </Link>
        </div>
      </div>

      {stats && (
        <div className="grid grid--tiles">
          <StatTile label="Total observations" value={number(stats.total)} to={`/observations?module_id=${module.id}`} />
          <StatTile label="Pending" value={number(stats.open)} to={`/observations?module_id=${module.id}&open=1`} />
          <StatTile label="Overdue" value={number(stats.overdue)} tone={stats.overdue ? 'alert' : undefined} to={`/observations?module_id=${module.id}&overdue=1`} />
          <StatTile label="Closed" value={number(stats.closed)} to={`/observations?module_id=${module.id}&closed=1`} />
          {code === 'SR' && (
            <StatTile label="Critical open" value={number(stats.critical_open)} tone={stats.critical_open ? 'alert' : undefined} to={`/observations?module_id=${module.id}&critical=1&open=1`} />
          )}
          <StatTile label="Repeated" value={number(stats.repeated)} to={`/observations?module_id=${module.id}&repeated=1`} />
        </div>
      )}

      <Card
        title="Inspection items in this module"
        subtitle={`${groups.reduce((sum, g) => sum + g.items.length, 0)} items across ${groups.length} categories - all configurable by the administrator`}
        icon="list"
      >
        {loading && groups.length === 0 ? (
          <Loading />
        ) : (
          <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            {groups.map((group) => (
              <div key={group.group_id}>
                <div className="section-label" style={{ marginBottom: 5 }}>{group.group_name}</div>
                <div className="chips">
                  {group.items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/observations?item_id=${item.id}`}
                      className="chip"
                      title={item.default_department_name ? `Usually actioned by ${item.default_department_name}` : undefined}
                    >
                      {item.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Latest observations"
        action={<Link to={`/observations?module_id=${module.id}`} className="chart__toggle">View all</Link>}
        pad={false}
      >
        {recent.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No observations in this module yet"
            action={<Link to={`/inspections/new?module=${code}`} className="btn">Start an inspection</Link>}
          />
        ) : (
          <div className="stack card__body" style={{ '--gap': '10px' } as React.CSSProperties}>
            {recent.map((o) => <ObservationCard key={o.id} observation={o} showModule={false} />)}
          </div>
        )}
      </Card>

      {code === 'SR' && (
        <Card title="Scope of this module" icon="info">
          <p className="small">
            Safe Running - Commercial covers only commercial-department-related items bearing on safe, orderly and
            compliant running of passenger trains: passenger boarding and movement, coach commercial working, catering
            and parcel obstruction, vendor conduct and emergency facilitation.
          </p>
          <p className="small" style={{ marginTop: 8 }}>
            Technical safety items belonging exclusively to Engineering, Electrical, S&amp;T, Mechanical or Operating are
            not duplicated here. Where such a defect is noticed during inspection, record it and assign it to that
            department through <strong>Action By</strong>.
          </p>
          <div className="row row--wrap" style={{ gap: 6, marginTop: 10 }}>
            {['Commercial', 'Operating', 'Engineering', 'Electrical', 'S&T', 'Mechanical', 'RPF', 'Medical'].map((d) => (
              <Badge key={d} tone="outline">{d}</Badge>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
