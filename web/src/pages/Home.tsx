import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { IS_DEMO } from '../api/transport';
import Icon, { type IconName } from '../components/Icon';
import { Badge, Banner, Card, EmptyState, Skeletons, StatTile, StatusBadge } from '../components/ui';
import { moduleTone, number, relativeTime } from '../lib/format';
import type { Module, ObservationStatus } from '../api/types';

interface HomePayload {
  modules: (Module & { total: number; open: number; overdue: number; closed: number; critical_open: number })[];
  tiles: Record<string, number>;
  /** An inspection still in progress is resumable work, so it leads the screen. */
  active_inspection: {
    id: number; ref_no: string; title: string | null;
    station_name: string | null; station_code: string | null; train_number: string | null;
    module_code: string; inspection_type_name: string; started_at: string | null;
    areas_on_sheet: number; areas_covered: number; areas_not_available: number;
    coverage_pct: number | null; items_checked: number; observation_count: number;
  } | null;
  recent_observations: {
    id: number; ref_no: string; observation: string; status: ObservationStatus;
    severity_name: string; module_code: string; station_name: string | null;
    unit_name: string | null; item_name: string | null; tdc: string | null;
    is_overdue: number; observed_at: string;
  }[];
}

const MODULE_ICON: Record<string, IconName> = { PA: 'water', CI: 'clipboard', SR: 'shield' };

export default function Home() {
  const { user, counters } = useAuth();
  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get<HomePayload>('/dashboard/home')
      .then((payload) => alive && setData(payload))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const isSupervisor = user?.role === 'supervisor';
  const tiles = data?.tiles ?? {};

  return (
    <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>
          {greeting()}, {firstName(user?.name)}
        </h1>
        <p>
          {user?.designation}
          {user?.station_name ? ` · ${user.station_name}` : ''}
          {user?.division_name ? ` · ${user.division_name} Division` : ''}
        </p>
      </div>

      {IS_DEMO && (
        <Banner tone="info" icon="info">
          <strong>Offline demonstration build.</strong> The whole application, including its data, is inside this one
          file - nothing is sent anywhere and no server is involved. Everything you record is real while the page is
          open; reloading restores the original demonstration data. Server-generated PDF and Excel reports, email and
          SMS delivery are the only parts that cannot run here.
        </Banner>
      )}

      {/* The three inspection streams */}
      <div className="grid grid--3">
        {(data?.modules ?? []).map((module) => {
          const tone = moduleTone(module.accent);
          return (
            <Link
              key={module.id}
              to={`/modules/${module.code}`}
              className="modcard"
              style={{
                '--tone': `var(--mod-${tone})`,
                '--tone-soft': `var(--mod-${tone}-soft)`,
              } as React.CSSProperties}
            >
              <div className="modcard__icon">
                <Icon name={MODULE_ICON[module.code] ?? 'clipboard'} size={21} />
              </div>
              <div className="modcard__name">{module.name}</div>
              <div className="modcard__tag">{module.tagline}</div>
              <div className="modcard__stats">
                <div>
                  <div className="modcard__stat-val">{number(module.open)}</div>
                  <div className="modcard__stat-lbl">Pending</div>
                </div>
                <div>
                  <div className="modcard__stat-val" style={module.overdue ? { color: 'var(--critical)' } : undefined}>
                    {number(module.overdue)}
                  </div>
                  <div className="modcard__stat-lbl">Overdue</div>
                </div>
                <div>
                  <div className="modcard__stat-val">{number(module.closed)}</div>
                  <div className="modcard__stat-lbl">Closed</div>
                </div>
              </div>
            </Link>
          );
        })}
        {loading && !data && <Skeletons rows={3} height={168} />}
      </div>

      {/* An inspection left in progress is the first thing to deal with: it is
          half a record until it is finished. */}
      {data?.active_inspection && (
        <Link to={`/inspections/${data.active_inspection.id}`} className="tile tile--accent" style={{ display: 'block' }}>
          <div className="tile__label"><Icon name="clipboard" size={13} /> Inspection in progress</div>
          <div className="tile__value" style={{ fontSize: '1.05rem' }}>
            {data.active_inspection.station_name
              ?? data.active_inspection.train_number
              ?? data.active_inspection.ref_no}
          </div>
          <div className="tile__foot">
            {data.active_inspection.areas_covered} of{' '}
            {data.active_inspection.areas_on_sheet - data.active_inspection.areas_not_available} areas attended to
            {data.active_inspection.coverage_pct != null && ` (${data.active_inspection.coverage_pct}%)`}
            {' · '}{data.active_inspection.items_checked} items checked
            {' · '}{data.active_inspection.observation_count} deficiencies
          </div>
        </Link>
      )}

      {/* Primary actions */}
      <div className="grid grid--tiles">
        <Link to="/inspections/new" className="tile tile--accent">
          <div className="tile__label"><Icon name="plus" size={13} /> Start</div>
          <div className="tile__value" style={{ fontSize: '1.15rem' }}>New Inspection</div>
          <div className="tile__foot">One visit, every area you attend to</div>
        </Link>
        <StatTile
          label="My Inspections"
          value={number(tiles.my_inspections)}
          foot={tiles.my_areas_covered ? `${number(tiles.my_areas_covered)} areas · ${number(tiles.my_items_checked)} items checked` : undefined}
          to="/inspections"
          icon="clipboard"
        />
        <StatTile label="Pending Observations" value={number(tiles.pending_observations)} to="/observations?open=1" icon="list" />
        <StatTile
          label={isSupervisor ? 'Compliance Pending' : 'Awaiting Verification'}
          value={number(isSupervisor ? tiles.compliance_pending : tiles.awaiting_verification)}
          to="/compliance"
          icon="check"
        />
        <StatTile
          label="Overdue Observations"
          value={number(tiles.overdue)}
          tone={tiles.overdue ? 'alert' : undefined}
          to="/observations?overdue=1"
          icon="alert"
        />
        <StatTile label="Reports" value={<Icon name="file" size={26} />} to="/reports" />
        <StatTile label="Dashboard" value={<Icon name="chart" size={26} />} to="/dashboard" />
      </div>

      {(counters?.critical_open ?? 0) > 0 && (
        <Link to="/observations?critical=1&open=1" style={{ textDecoration: 'none' }}>
          <div className="banner banner--danger">
            <span className="banner__icon"><Icon name="alert" size={16} /></span>
            <div style={{ flex: 1 }}>
              <strong>{counters?.critical_open} critical observation{counters?.critical_open === 1 ? '' : 's'} open.</strong>{' '}
              Immediate attention required.
            </div>
            <Icon name="chevron-right" size={16} />
          </div>
        </Link>
      )}

      <Card
        title="Recent activity"
        subtitle="Observations you raised or that are assigned to you"
        action={<Link to="/observations" className="chart__toggle">View all</Link>}
        pad={false}
      >
        {loading && !data ? (
          <div className="card__body"><Skeletons rows={3} /></div>
        ) : (data?.recent_observations.length ?? 0) === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No observations yet"
            text="Start an inspection and record your first observation. It will appear here with its compliance status."
            action={<Link to="/inspections/new" className="btn">New Inspection</Link>}
          />
        ) : (
          <div className="stack" style={{ '--gap': '0px' } as React.CSSProperties}>
            {data?.recent_observations.map((o) => (
              <Link
                key={o.id}
                to={`/observations/${o.id}`}
                style={{
                  display: 'block', padding: '11px 14px', borderBottom: '1px solid var(--line)',
                  color: 'inherit', textDecoration: 'none',
                }}
              >
                <div className="row row--wrap" style={{ gap: 6, marginBottom: 3 }}>
                  <span className="obs__ref">{o.ref_no}</span>
                  <StatusBadge status={o.status} />
                  {!!o.is_overdue && <Badge tone="critical"><Icon name="alert" size={11} /> Overdue</Badge>}
                  <span className="spacer" />
                  <span className="xsmall muted">{relativeTime(o.observed_at)}</span>
                </div>
                <div className="small clamp-2">{o.observation}</div>
                <div className="xsmall muted" style={{ marginTop: 3 }}>
                  {[o.item_name, o.unit_name, o.station_name].filter(Boolean).join(' · ')}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** "R. K. Sharma" has no usable first name, so fall back to the full name. */
/**
 * How to address whoever is signed in.
 *
 * Accounts are held by posts as often as by people, and "Good morning, Chief" is
 * not how you greet the Chief Commercial Inspector. A name carrying a slash or a
 * designation word is a post and is used whole; a personal name gives its first
 * name, unless that is an initial, in which case the whole name reads better.
 */
const POST_WORDS = /\b(manager|inspector|officer|supervisor|sse|je|aen|iow|administrator|superintendent|master|engineer)\b/i;

function firstName(name?: string | null): string {
  if (!name) return 'Officer';
  const trimmed = name.trim();
  if (trimmed.includes('/') || POST_WORDS.test(trimmed)) return trimmed;
  const first = trimmed.split(/\s+/)[0] ?? '';
  return first.length <= 2 || first.endsWith('.') ? trimmed : first;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
