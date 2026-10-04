import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import Icon from '../components/Icon';
import { Badge, Card, Loading, SearchSelect, StatTile, Tabs } from '../components/ui';
import { BarChart, StackedBars } from '../components/charts/BarChart';
import { TrendChart, type TrendPoint } from '../components/charts/TrendChart';
import { STATUS_COLOR } from '../components/charts/theme';
import { formatDate, moduleTone, number } from '../lib/format';
import type { DashboardOverview, ModuleStat, Module } from '../api/types';

interface DepartmentRow {
  department_id: number; department_name: string; total: number; pending: number;
  due_soon: number; overdue: number; compliance_submitted: number; closed: number;
  critical: number; avg_closure_days: number | null;
}

interface StationRow {
  station_id: number; station_name: string; station_code: string; division_name: string;
  observations: number; pending: number; overdue: number; closed: number; repeated: number;
  critical: number; passenger_amenities: number; commercial: number; safe_running: number;
  inspections: number; last_observation_at: string;
}

interface SeverityRow {
  severity_id: number; severity_name: string; severity_rank: number;
  total: number; open: number; overdue: number; closed: number;
}

interface RepeatRow {
  station_name: string; station_code: string; unit_name: string; item_name: string;
  module_code: string; occurrences: number; open: number; last_seen: string; refs: string[];
}

interface DeficiencyRow {
  deficiency_id: number; text: string; item_name: string | null; module_code: string;
  occurrences: number; open: number; overdue: number; stations: number; last_seen: string;
}

interface SupervisorRow {
  supervisor_id: number; supervisor_name: string; supervisor_designation: string | null;
  department_name: string; assigned: number; pending: number; overdue: number;
  closed: number; avg_response_days: number | null;
}

type Tab = 'overview' | 'inspections' | 'modules' | 'departments' | 'stations' | 'repeats' | 'supervisors';

/**
 * The inspection-wise panel. Every other panel counts observations, which says
 * what is wrong; this one counts visits and coverage, which says whether the
 * inspecting is happening and how much of each station it reached.
 */
interface InspectionDashboard {
  totals: {
    inspections: number; completed: number; in_progress: number; reports_issued: number;
    inspectors: number; locations: number;
    areas_on_sheet: number; areas_covered: number; areas_satisfactory: number;
    areas_with_deficiencies: number; areas_not_inspected: number; areas_not_available: number;
    items_checked: number; items_ok: number; observations: number;
    coverage_pct: number | null; observations_per_inspection: number; areas_per_inspection: number;
  };
  by_inspector: {
    inspector_id: number; inspector_name: string; inspector_designation: string | null;
    inspections: number; areas_covered: number; items_checked: number; observations: number;
    last_inspection: string | null;
  }[];
  by_module: { module_id: number; module_code: string; module_name: string; module_accent: string | null;
    inspections: number; areas_covered: number; observations: number }[];
  recent: {
    id: number; ref_no: string; inspection_no: string | null; title: string | null;
    station_name: string | null; station_code: string | null; train_number: string | null;
    module_code: string; inspection_type_name: string; inspector_name: string;
    started_at: string | null; created_at: string;
    areas_on_sheet: number; areas_covered: number; areas_satisfactory: number;
    areas_with_deficiencies: number; coverage_pct: number | null;
    items_checked: number; observation_count: number; open_count: number;
    status: string; report_status: string;
  }[];
}

const RANGES = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
  { value: '', label: 'All time' },
];

export default function Dashboard() {
  const { masters } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState('90');
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [divisionId, setDivisionId] = useState<number | null>(null);

  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [modulesStat, setModulesStat] = useState<ModuleStat[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [severity, setSeverity] = useState<SeverityRow[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [repeats, setRepeats] = useState<RepeatRow[]>([]);
  const [deficiencies, setDeficiencies] = useState<DeficiencyRow[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorRow[]>([]);
  const [inspections, setInspections] = useState<InspectionDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const filters = useCallback(
    () => ({
      days: days || undefined,
      module_id: moduleId ?? undefined,
      division_id: divisionId ?? undefined,
    }),
    [days, moduleId, divisionId]
  );

  useEffect(() => {
    setLoading(true);
    const f = filters();
    Promise.all([
      api.get<DashboardOverview>('/dashboard/overview', f),
      api.get<{ data: ModuleStat[] }>('/dashboard/modules', f),
      api.get<{ data: DepartmentRow[] }>('/dashboard/departments', f),
      api.get<{ data: StationRow[] }>('/dashboard/stations', { ...f, limit: 30 }),
      api.get<{ data: SeverityRow[] }>('/dashboard/severity', f),
      api.get<{ days: number; data: TrendPoint[] }>('/dashboard/trends', { ...f, days: Math.min(Number(days || 90), 90) }),
      api.get<{ data: RepeatRow[] }>('/dashboard/repeats', { ...f, limit: 15 }),
      api.get<{ data: SupervisorRow[] }>('/dashboard/supervisors', f),
      api.get<{ data: DeficiencyRow[] }>('/dashboard/deficiencies', { ...f, limit: 15 }),
      api.get<InspectionDashboard>('/dashboard/inspections', { ...f, limit: 10 }),
    ])
      .then(([o, m, d, s, sev, t, r, sup, def, insp]) => {
        setOverview(o);
        setModulesStat(m.data);
        setDepartments(d.data);
        setStations(s.data);
        setSeverity(sev.data);
        setTrend(t.data);
        setRepeats(r.data);
        setSupervisors(sup.data);
        setDeficiencies(def.data);
        setInspections(insp);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters, days]);

  if (loading && !overview) return <Loading label="Building the dashboard" />;

  const obs = overview?.observations ?? {};
  const insp = overview?.inspections ?? {};
  const comp = overview?.compliance;

  const statusMix = [
    { label: 'Submitted / assigned', value: (obs.submitted ?? 0) + (obs.assigned ?? 0) },
    { label: 'Acknowledged', value: obs.acknowledged ?? 0 },
    { label: 'Action in progress', value: obs.in_progress ?? 0 },
    { label: 'Compliance submitted', value: obs.compliance_submitted ?? 0 },
    { label: 'Closed', value: obs.closed ?? 0 },
    { label: 'Reopened', value: obs.reopened ?? 0 },
    { label: 'Cancelled', value: obs.cancelled ?? 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>Inspection and compliance performance across the division</p>
      </div>

      {/* Filters in one row above the charts */}
      <div className="row row--wrap" style={{ gap: 8 }}>
        <div style={{ minWidth: 150, flex: '1 1 150px' }}>
          <div className="select-wrap">
            <select className="select" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
              {RANGES.map((r) => <option key={r.label} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ minWidth: 170, flex: '1 1 170px' }}>
          <SearchSelect
            options={(masters?.modules ?? []).map((m: Module) => ({ value: m.id, label: m.name }))}
            value={moduleId}
            onChange={(v) => setModuleId(v as number | null)}
            placeholder="All three modules"
          />
        </div>
        <div style={{ minWidth: 150, flex: '1 1 150px' }}>
          <SearchSelect
            options={(masters?.divisions ?? []).map((d) => ({ value: d.id, label: `${d.name} Division` }))}
            value={divisionId}
            onChange={(v) => setDivisionId(v as number | null)}
            placeholder="All divisions"
          />
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'inspections', label: 'Inspection-wise' },
          { key: 'modules', label: 'Module-wise' },
          { key: 'departments', label: 'Department-wise' },
          { key: 'stations', label: 'Station-wise' },
          { key: 'repeats', label: 'Repeated' },
          { key: 'supervisors', label: 'Supervisors' },
        ]}
        value={tab}
        onChange={(key) => setTab(key as Tab)}
      />

      {tab === 'overview' && (
        <>
          <div className="grid grid--tiles">
            <StatTile label="Total inspections" value={number(insp.total)} foot={`${number(insp.today)} today`} to="/inspections?scope=all" />
            <StatTile label="Total observations" value={number(obs.total)} foot={`${number(obs.with_tdc)} with a TDC`} to="/observations" />
            <StatTile label="Open observations" value={number(obs.open)} to="/observations?open=1" />
            <StatTile label="Overdue" value={number(obs.overdue)} tone={obs.overdue ? 'alert' : undefined} to="/observations?overdue=1" />
            <StatTile label="Due within 3 days" value={number(obs.due_soon)} tone={obs.due_soon ? 'warn' : undefined} to="/observations?due_soon=1" />
            <StatTile label="Compliance submitted" value={number(obs.compliance_submitted)} to="/observations?awaiting_verification=1" />
            <StatTile label="Closed" value={number(obs.closed)} foot={`${comp?.closure_rate ?? 0}% closure rate`} to="/observations?closed=1" />
            <StatTile label="Reopened" value={number(obs.reopened)} to="/observations?status=reopened" />
            <StatTile label="Critical open" value={number(obs.critical_open)} tone={obs.critical_open ? 'alert' : undefined} to="/observations?critical=1&open=1" />
            <StatTile label="Repeated deficiencies" value={number(obs.repeated)} to="/observations?repeated=1" />
          </div>

          <div className="grid grid--wide">
            <Card title="Observations raised and closed" subtitle={`Last ${Math.min(Number(days || 90), 90)} days`}>
              <TrendChart data={trend} />
            </Card>

            <Card title="Where the work stands" subtitle="Current status of every observation in this view">
              <BarChart data={statusMix} />
            </Card>

            <Card title="Severity mix" subtitle="Open and closed by severity">
              <StackedBars
                rows={severity.map((s) => ({
                  label: s.severity_name,
                  sub: `${s.overdue} overdue`,
                  values: { open: s.open, closed: s.closed },
                }))}
                seriesDef={[
                  { key: 'open', label: 'Open', color: STATUS_COLOR.serious },
                  { key: 'closed', label: 'Closed', color: STATUS_COLOR.good },
                ]}
              />
            </Card>

            <Card title="Compliance performance" subtitle="How quickly deficiencies are being closed">
              <div className="grid grid--2" style={{ gap: 10 }}>
                <div>
                  <div className="tile__label">Average closure time</div>
                  <div className="hero-figure">{comp?.avg_closure_days ?? '-'}</div>
                  <div className="xsmall muted">days from observation to closure</div>
                </div>
                <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <div>
                    <div className="tile__label">Closed within TDC</div>
                    <div className="strong mono-num" style={{ fontSize: '1.3rem', color: STATUS_COLOR.good }}>
                      {number(comp?.closed_on_time)}
                    </div>
                  </div>
                  <div>
                    <div className="tile__label">Closed after TDC</div>
                    <div className="strong mono-num" style={{ fontSize: '1.3rem', color: STATUS_COLOR.critical }}>
                      {number(comp?.closed_late)}
                    </div>
                  </div>
                  <div className="xsmall muted">
                    Fastest {comp?.fastest_closure_days ?? '-'}d · slowest {comp?.slowest_closure_days ?? '-'}d
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {tab === 'inspections' && inspections && (
        <>
          {/* Visits and coverage. One inspector attends to many areas in a visit,
              so the visit is what is counted here - never the area. */}
          <div className="grid grid--tiles">
            <StatTile label="Inspections" value={number(inspections.totals.inspections)}
              foot={`${number(inspections.totals.in_progress)} in progress`} to="/inspections?scope=all" />
            <StatTile label="Locations inspected" value={number(inspections.totals.locations)} />
            <StatTile label="Inspecting officers" value={number(inspections.totals.inspectors)} />
            <StatTile label="Areas attended to" value={number(inspections.totals.areas_covered)}
              foot={`of ${number(inspections.totals.areas_on_sheet - inspections.totals.areas_not_available)} on the sheets`} />
            <StatTile label="Coverage" value={`${inspections.totals.coverage_pct ?? 0}%`}
              foot={`${inspections.totals.areas_per_inspection} areas per inspection`} />
            <StatTile label="Areas found in order" value={number(inspections.totals.areas_satisfactory)} />
            <StatTile label="Items checked" value={number(inspections.totals.items_checked)}
              foot={`${number(inspections.totals.items_ok)} found in order`} />
            <StatTile label="Deficiencies raised" value={number(inspections.totals.observations)}
              foot={`${inspections.totals.observations_per_inspection} per inspection`} />
            <StatTile label="Reports issued" value={number(inspections.totals.reports_issued)} />
          </div>

          <Card title="By inspecting officer" subtitle="Visits, coverage and what they raised" icon="users" pad={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Officer</th><th className="num">Inspections</th><th className="num">Areas</th>
                    <th className="num">Items checked</th><th className="num">Deficiencies</th><th>Last inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.by_inspector.map((r) => (
                    <tr key={r.inspector_id}>
                      <td>
                        {r.inspector_name}
                        {r.inspector_designation && <div className="xsmall muted">{r.inspector_designation}</div>}
                      </td>
                      <td className="num mono-num">{r.inspections}</td>
                      <td className="num mono-num">{r.areas_covered}</td>
                      <td className="num mono-num">{r.items_checked}</td>
                      <td className="num mono-num">{r.observations}</td>
                      <td className="xsmall">{r.last_inspection ? formatDate(r.last_inspection) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Recent inspections" subtitle="How much of each location the visit covered" icon="clipboard" pad={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Inspection</th><th>Location</th><th>Officer</th>
                    <th className="num">Areas</th><th className="num">Coverage</th>
                    <th className="num">Items</th><th className="num">Deficiencies</th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.recent.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/inspections/${r.id}`}>{r.inspection_no ?? r.ref_no}</Link>
                        <div className="xsmall muted">
                          {formatDate(r.started_at ?? r.created_at)} · {r.inspection_type_name}
                        </div>
                      </td>
                      <td className="small">
                        {r.station_name ? `${r.station_name} (${r.station_code})` : r.train_number ?? '-'}
                      </td>
                      <td className="xsmall">{r.inspector_name}</td>
                      <td className="num mono-num">{r.areas_covered}/{r.areas_on_sheet}</td>
                      <td className="num mono-num">{r.coverage_pct ?? 0}%</td>
                      <td className="num mono-num">{r.items_checked}</td>
                      <td className="num mono-num">{r.observation_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'modules' && (
        <>
          <div className="grid grid--3">
            {modulesStat.map((m) => (
              <Link
                key={m.module.id}
                to={`/modules/${m.module.code}`}
                className="modcard"
                style={{
                  '--tone': `var(--mod-${moduleTone(m.module.accent)})`,
                  '--tone-soft': `var(--mod-${moduleTone(m.module.accent)}-soft)`,
                } as React.CSSProperties}
              >
                <div className="modcard__name">{m.module.name}</div>
                <div className="modcard__tag">{m.module.tagline}</div>
                <div className="modcard__stats">
                  <div>
                    <div className="modcard__stat-val">{number(m.total)}</div>
                    <div className="modcard__stat-lbl">Total</div>
                  </div>
                  <div>
                    <div className="modcard__stat-val">{number(m.open)}</div>
                    <div className="modcard__stat-lbl">Pending</div>
                  </div>
                  <div>
                    <div className="modcard__stat-val" style={m.overdue ? { color: 'var(--critical)' } : undefined}>{number(m.overdue)}</div>
                    <div className="modcard__stat-lbl">Overdue</div>
                  </div>
                  <div>
                    <div className="modcard__stat-val">{number(m.closed)}</div>
                    <div className="modcard__stat-lbl">Closed</div>
                  </div>
                </div>
                {m.module.code === 'SR' && m.critical > 0 && (
                  <div style={{ marginTop: 10 }}><Badge tone="critical">{m.critical} critical</Badge></div>
                )}
              </Link>
            ))}
          </div>
          <Card title="Module comparison" subtitle="Closed, pending and overdue observations per inspection stream">
            <StackedBars
              rows={modulesStat.map((m) => ({
                label: m.module.name,
                sub: `${m.inspections} inspections · ${m.critical} critical`,
                values: {
                  closed: m.closed,
                  pending: Math.max(0, m.open - m.overdue),
                  overdue: m.overdue,
                },
              }))}
              seriesDef={[
                { key: 'closed', label: 'Closed', colorIndex: 2 },
                { key: 'pending', label: 'Pending', colorIndex: 0 },
                { key: 'overdue', label: 'Overdue', colorIndex: 1 },
              ]}
            />
          </Card>
        </>
      )}

      {tab === 'departments' && (
        <>
          <Card title="Department workload" subtitle="Observations assigned to each department">
            <StackedBars
              rows={departments.map((d) => ({
                label: d.department_name,
                sub: d.avg_closure_days ? `Average closure ${d.avg_closure_days} days` : undefined,
                values: { closed: d.closed, pending: Math.max(0, d.pending - d.overdue), overdue: d.overdue },
              }))}
              seriesDef={[
                { key: 'closed', label: 'Closed', colorIndex: 2 },
                { key: 'pending', label: 'Pending', colorIndex: 0 },
                { key: 'overdue', label: 'Overdue', colorIndex: 1 },
              ]}
              onSelect={(label) => {
                const row = departments.find((d) => d.department_name === label);
                if (row) window.location.assign(`/observations?department_id=${row.department_id}&open=1`);
              }}
            />
          </Card>
          <Card title="Department-wise detail" pad={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Department</th><th className="num">Total</th><th className="num">Pending</th>
                    <th className="num">Due soon</th><th className="num">Overdue</th>
                    <th className="num">Compliance submitted</th><th className="num">Closed</th>
                    <th className="num">Critical</th><th className="num">Avg closure (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.department_id}>
                      <td><Link to={`/observations?department_id=${d.department_id}`}>{d.department_name}</Link></td>
                      <td className="num">{d.total}</td>
                      <td className="num">{d.pending}</td>
                      <td className="num">{d.due_soon}</td>
                      <td className="num" style={d.overdue ? { color: 'var(--critical)', fontWeight: 700 } : undefined}>{d.overdue}</td>
                      <td className="num">{d.compliance_submitted}</td>
                      <td className="num">{d.closed}</td>
                      <td className="num">{d.critical}</td>
                      <td className="num">{d.avg_closure_days ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'stations' && (
        <>
          <Card title="Stations with the most pending work" subtitle="Tap a station for its complete inspection history">
            <BarChart
              data={stations.slice(0, 12).map((s) => ({
                label: `${s.station_name} (${s.station_code})`,
                value: s.pending,
                sub: `${s.observations} observations · ${s.overdue} overdue · ${s.repeated} repeated`,
                href: `/stations/${s.station_id}`,
              }))}
              onSelect={(d) => d.href && window.location.assign(d.href)}
            />
          </Card>
          <Card title="Station-wise detail" pad={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Station</th><th>Division</th><th className="num">Inspections</th>
                    <th className="num">Observations</th><th className="num">Pending</th>
                    <th className="num">Overdue</th><th className="num">Closed</th>
                    <th className="num">Repeated</th><th className="num">Amenities</th>
                    <th className="num">Commercial</th><th className="num">Safe running</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.map((s) => (
                    <tr key={s.station_id}>
                      <td><Link to={`/stations/${s.station_id}`}>{s.station_name} ({s.station_code})</Link></td>
                      <td className="xsmall">{s.division_name}</td>
                      <td className="num">{s.inspections}</td>
                      <td className="num">{s.observations}</td>
                      <td className="num">{s.pending}</td>
                      <td className="num" style={s.overdue ? { color: 'var(--critical)', fontWeight: 700 } : undefined}>{s.overdue}</td>
                      <td className="num">{s.closed}</td>
                      <td className="num">{s.repeated}</td>
                      <td className="num">{s.passenger_amenities}</td>
                      <td className="num">{s.commercial}</td>
                      <td className="num">{s.safe_running}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'repeats' && (
        <>
        <Card
          title="Most reported deficiencies"
          subtitle="Counted from the suggestion the inspector picked, so the wording of each report does not matter"
          icon="list"
          pad={false}
        >
          {deficiencies.length === 0 ? (
            <div className="card__body">
              <p className="small muted">
                Nothing yet. This fills up as observations are raised from the suggested-deficiency list on the New
                Inspection screen.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Deficiency</th><th>Item</th><th>Module</th>
                    <th className="num">Times</th><th className="num">Open</th>
                    <th className="num">Overdue</th><th className="num">Stations</th><th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {deficiencies.map((d) => (
                    <tr key={`${d.deficiency_id}-${d.item_name}`}>
                      <td className="strong">{d.text}</td>
                      <td>{d.item_name ?? '-'}</td>
                      <td><Badge tone="outline">{d.module_code}</Badge></td>
                      <td className="num strong">{d.occurrences}</td>
                      <td className="num">{d.open}</td>
                      <td className="num" style={d.overdue ? { color: 'var(--critical)', fontWeight: 700 } : undefined}>{d.overdue}</td>
                      <td className="num">{d.stations}</td>
                      <td className="xsmall">{d.last_seen?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card
          title="Repeated deficiencies"
          subtitle="Same amenity or item recurring at the same unit"
          icon="repeat"
          pad={false}
        >
          {repeats.length === 0 ? (
            <div className="card__body"><p className="small muted">No recurring deficiency in this period.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Station</th><th>Unit / Area</th><th>Item</th><th>Module</th>
                    <th className="num">Times</th><th className="num">Still open</th><th>Last seen</th><th>Observation IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {repeats.map((r, index) => (
                    <tr key={index}>
                      <td>{r.station_name} ({r.station_code})</td>
                      <td>{r.unit_name}</td>
                      <td className="strong">{r.item_name}</td>
                      <td><Badge tone="outline">{r.module_code}</Badge></td>
                      <td className="num strong">{r.occurrences}</td>
                      <td className="num" style={r.open ? { color: 'var(--critical)', fontWeight: 700 } : undefined}>{r.open}</td>
                      <td className="xsmall">{r.last_seen?.slice(0, 10)}</td>
                      <td className="xsmall">{r.refs.slice(0, 4).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </>
      )}

      {tab === 'supervisors' && (
        <>
          <Card title="Supervisors with overdue items" subtitle="Ranked by overdue observations">
            <BarChart
              data={supervisors.slice(0, 12).map((s) => ({
                label: s.supervisor_name,
                value: s.overdue,
                sub: `${s.department_name} · ${s.pending} pending of ${s.assigned} assigned`,
              }))}
              color={STATUS_COLOR.serious}
            />
          </Card>
          <Card title="Supervisor performance" pad={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Supervisor</th><th>Department</th><th className="num">Assigned</th>
                    <th className="num">Pending</th><th className="num">Overdue</th>
                    <th className="num">Closed</th><th className="num">Avg response (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {supervisors.map((s) => (
                    <tr key={s.supervisor_id}>
                      <td>
                        {s.supervisor_name}
                        <div className="xsmall muted">{s.supervisor_designation}</div>
                      </td>
                      <td className="xsmall">{s.department_name}</td>
                      <td className="num">{s.assigned}</td>
                      <td className="num">{s.pending}</td>
                      <td className="num" style={s.overdue ? { color: 'var(--critical)', fontWeight: 700 } : undefined}>{s.overdue}</td>
                      <td className="num">{s.closed}</td>
                      <td className="num">{s.avg_response_days ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <div className="center">
        <Link to="/reports" className="btn btn--ghost btn--sm">
          <Icon name="file" size={14} /> Generate a formatted report from this data
        </Link>
      </div>
    </div>
  );
}
