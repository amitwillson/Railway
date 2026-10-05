import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError, reportUrl } from '../api/client';
import { exportReport } from '../api/transport';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import Icon from '../components/Icon';
import {
  Badge, Banner, Button, Card, EmptyState, Field, Loading, Pager, Sheet, Tabs,
} from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';
import { SearchSelect } from '../components/ui';
import type {
  Department, Feedback, FeedbackPayload, FeedbackStatus, Station, Supervisor,
} from '../api/types';

type Tab = 'masters' | 'supervisors' | 'users' | 'feedback' | 'settings' | 'audit' | 'system';

interface ResourceMeta { key: string; label: string; columns: string[]; count: number; searchable: boolean }
type Row = Record<string, string | number | null>;

export default function Admin() {
  const { section } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>((section as Tab) ?? 'masters');

  useEffect(() => {
    if (section && section !== tab) setTab(section as Tab);
  }, [section, tab]);

  if (!can('admin', 'divisional_officer')) {
    return (
      <Card>
        <EmptyState icon="shield" title="Administrator access required" text="This area is restricted to administrators and divisional officers." />
      </Card>
    );
  }

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Admin Panel</h1>
        <p>Master data, users, rules and the audit trail. No code change is needed for routine changes.</p>
      </div>

      <Tabs
        tabs={[
          { key: 'masters', label: 'Master data' },
          { key: 'supervisors', label: 'Supervisors' },
          { key: 'users', label: 'Users' },
          { key: 'feedback', label: 'Feedback' },
          { key: 'settings', label: 'Settings & rules' },
          { key: 'audit', label: 'Audit trail' },
          { key: 'system', label: 'System' },
        ]}
        value={tab}
        onChange={(key) => {
          setTab(key as Tab);
          navigate(`/admin/${key}`);
        }}
      />

      {tab === 'masters' && <Masters />}
      {tab === 'supervisors' && <SupervisorLinks />}
      {tab === 'users' && <Users />}
      {tab === 'feedback' && <FeedbackInbox />}
      {tab === 'settings' && <Settings />}
      {tab === 'audit' && <Audit />}
      {tab === 'system' && <System />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Master data                                                                */
/* -------------------------------------------------------------------------- */

function Masters() {
  const toast = useToast();
  const { can } = useAuth();
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const [selected, setSelected] = useState<string>('stations');
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    api.get<{ data: ResourceMeta[] }>('/admin/resources').then((r) => setResources(r.data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ data: Row[]; columns: string[]; total: number }>(`/admin/masters/${selected}`, {
      q: term || undefined, limit: 200,
    })
      .then((r) => {
        setRows(r.data);
        setColumns(r.columns);
        setTotal(r.total);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [selected, term]);

  useEffect(load, [load]);

  const meta = resources.find((r) => r.key === selected);
  const editable = can('admin');

  const save = async (values: Row) => {
    try {
      if (editing === 'new') {
        await api.post(`/admin/masters/${selected}`, values);
        toast.success(`${meta?.label ?? 'Record'} added`);
      } else if (editing) {
        await api.patch(`/admin/masters/${selected}/${editing.id}`, values);
        toast.success(`${meta?.label ?? 'Record'} updated`);
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save');
    }
  };

  const deactivate = async (row: Row) => {
    try {
      await api.del(`/admin/masters/${selected}/${row.id}`);
      toast.success('Deactivated - existing records keep referring to it');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not deactivate');
    }
  };

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <div className="chips">
        {resources.map((r) => (
          <button
            key={r.key}
            className={`chip${selected === r.key ? ' chip--on' : ''} chip--count`}
            data-count={r.count}
            onClick={() => {
              setSelected(r.key);
              setTerm('');
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <Card
        title={meta?.label ?? titleCase(selected)}
        subtitle={`${total} record${total === 1 ? '' : 's'}`}
        action={
          editable ? (
            <div className="row" style={{ gap: 6 }}>
              {selected === 'stations' && (
                <Button size="sm" variant="quiet" icon="cloud-up" onClick={() => setImporting(true)}>
                  Import
                </Button>
              )}
              <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add</Button>
            </div>
          ) : undefined
        }
        pad={false}
      >
        {meta?.searchable && (
          <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder={`Search ${meta.label.toLowerCase()}`} value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        )}
        {loading ? (
          <div className="card__body"><Loading /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="list" title="No records" />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  {columns.slice(0, 8).map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} style={row.active === 0 ? { opacity: 0.5 } : undefined}>
                    {columns.slice(0, 8).map((c) => (
                      <td key={c} className="xsmall">
                        {c === 'active'
                          ? (row[c] ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>)
                          : String(row[c] ?? '-').slice(0, 70)}
                      </td>
                    ))}
                    {editable && (
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="icon-btn" onClick={() => setEditing(row)} aria-label="Edit"><Icon name="edit" size={14} /></button>
                          {row.active !== 0 && (
                            <button className="icon-btn" onClick={() => void deactivate(row)} aria-label="Deactivate"><Icon name="trash" size={14} /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {importing && <StationImport onClose={() => setImporting(false)} onDone={load} />}

      {editing && meta && (
        <Sheet
          title={editing === 'new' ? `Add ${meta.label}` : `Edit ${meta.label}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
              <Button form="master-form" type="submit">Save</Button>
            </>
          }
        >
          <form
            id="master-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const values: Row = {};
              for (const column of meta.columns) {
                const raw = form.get(column);
                if (raw === null) continue;
                const text = String(raw).trim();
                values[column] = text === '' ? null : /^(-?\d+)$/.test(text) ? Number(text) : text;
              }
              void save(values);
            }}
          >
            {meta.columns.map((column) => {
              const current = editing === 'new' ? '' : (editing[column] ?? '');
              const isBoolish = ['active', 'is_external', 'has_pantry', 'is_default_for_department', 'notify_immediately', 'escalate_immediately', 'remind_on_due_date', 'in_app', 'email', 'sms'].includes(column);
              return (
                <Field key={column} label={column.replace(/_/g, ' ')} htmlFor={`f-${column}`}>
                  {isBoolish ? (
                    <div className="select-wrap">
                      <select id={`f-${column}`} name={column} className="select" defaultValue={String(current ?? (column === 'active' ? 1 : 0))}>
                        <option value="1">Yes</option>
                        <option value="0">No</option>
                      </select>
                    </div>
                  ) : column === 'applies_to' ? (
                    <div className="select-wrap">
                      <select id={`f-${column}`} name={column} className="select" defaultValue={String(current || 'station')}>
                        <option value="station">station</option>
                        <option value="train">train</option>
                        <option value="both">both</option>
                      </select>
                    </div>
                  ) : column.endsWith('_id') || ['sort_order', 'rank', 'level', 'priority', 'platforms', 'after_days', 'remind_before_days', 'overdue_repeat_days', 'escalate_after_days', 'default_tdc_days'].includes(column) ? (
                    <input id={`f-${column}`} name={column} className="input" type="number" defaultValue={String(current ?? '')} />
                  ) : column === 'template_body' || column === 'notes' || column === 'definition' || column === 'description' || column === 'area_of_responsibility' ? (
                    <textarea id={`f-${column}`} name={column} className="textarea" style={{ minHeight: 80 }} defaultValue={String(current ?? '')} />
                  ) : (
                    <input id={`f-${column}`} name={column} className="input" defaultValue={String(current ?? '')} />
                  )}
                </Field>
              );
            })}
            <Banner tone="info">
              Foreign keys are entered as the referenced record's numeric id. Every change is recorded in the audit
              trail with its previous and new value.
            </Banner>
          </form>
        </Sheet>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Replacing the station list                                                 */
/*                                                                            */
/* Every division has to put its own station list in before the system is used */
/* in earnest, and editing forty stations one at a time is not a reasonable way */
/* to do that. Export gives the current list in exactly the shape the importer  */
/* accepts, and a dry run says what would change before anything is written.    */
/* -------------------------------------------------------------------------- */

interface ImportResult {
  dry_run: boolean;
  counts: { created: number; updated: number; deactivated: number; skipped: number };
  created: { line: number; code: string; name: string }[];
  updated: { line: number; code: string; name: string }[];
  deactivated: { code: string; name: string }[];
  skipped: { line: number; code: string; reason: string }[];
  total_after: number | null;
}

function StationImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const response = await api.post<ImportResult>('/admin/stations/import', {
        csv,
        dry_run: dryRun,
        deactivate_missing: deactivateMissing,
      });
      setResult(response);
      if (!dryRun) {
        toast.success(
          `${response.counts.created} added, ${response.counts.updated} updated, ${response.counts.deactivated} deactivated`
        );
        onDone();
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not read the file');
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setResult(null);
    };
    reader.readAsText(file);
  };

  return (
    <Sheet
      title="Import the station list"
      subtitle="CSV, identified by station code"
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Close</Button>
          <Button variant="ghost" loading={busy} disabled={csv.trim().length < 10} onClick={() => void run(true)}>
            Check
          </Button>
          <Button loading={busy} disabled={csv.trim().length < 10} onClick={() => void run(false)}>
            Import
          </Button>
        </>
      }
    >
      <Banner tone="info">
        The file needs a station code and a station name; division, zone, category, station type,
        section, platforms, latitude, longitude and active are optional. Column headings do not have
        to match exactly &mdash; <code>Station Code</code>, <code>STN CODE</code> and <code>code</code>
        are all read as the same column, as are <code>No. of Platforms</code> and{' '}
        <code>platforms</code>. A code already in the master is updated; a new one is added. Nothing
        is ever deleted.
      </Banner>

      <div className="row row--wrap" style={{ gap: 8, margin: '12px 0' }}>
        {exportReport ? (
          <span className="xsmall muted">Export is produced by the server in the deployed application.</span>
        ) : (
          <a className="btn btn--ghost btn--sm" href={reportUrl('/admin/stations/export', {})}>
            <Icon name="download" size={14} /> Export the current list
          </a>
        )}
        <label className="btn btn--ghost btn--sm">
          <Icon name="file" size={14} /> Choose a CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
        </label>
      </div>

      <Field label="CSV" hint="Paste it, or choose a file above">
        <textarea
          className="textarea"
          style={{ minHeight: 160, fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '0.78rem' }}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(null);
          }}
          placeholder={
            'Station Code,Station Name,Division,Zone,Category,Station Type,Section,No. of Platforms\n'
            + 'BSP,Bilaspur,BSP,SECR,NSG-2,Junction,JSG-BSP,8'
          }
        />
      </Field>

      <label className="pick">
        <input
          type="checkbox"
          checked={deactivateMissing}
          onChange={(e) => {
            setDeactivateMissing(e.target.checked);
            setResult(null);
          }}
        />
        <span className="small">
          Deactivate the stations not in this file
          <span className="xsmall muted" style={{ display: 'block' }}>
            They stay in the database, so old observations still resolve - they simply stop being offered.
          </span>
        </span>
      </label>

      {result && (
        <Card
          title={result.dry_run ? 'What this file would do' : 'Imported'}
          icon={result.dry_run ? 'info' : 'check'}
          className="mt-12"
        >
          <div className="row row--wrap" style={{ gap: 14, marginBottom: 10 }}>
            {([
              ['Added', result.counts.created],
              ['Updated', result.counts.updated],
              ['Deactivated', result.counts.deactivated],
              ['Skipped', result.counts.skipped],
            ] as [string, number][]).map(([label, value]) => (
              <span key={label} className="xsmall">
                <b className="mono-num" style={{ fontSize: '1.05rem' }}>{value}</b> <span className="muted">{label}</span>
              </span>
            ))}
          </div>
          {result.skipped.length > 0 && (
            <div className="stack" style={{ '--gap': '3px' } as React.CSSProperties}>
              {result.skipped.map((row) => (
                <div key={`${row.line}-${row.code}`} className="xsmall" style={{ color: 'var(--critical)' }}>
                  Line {row.line}{row.code ? ` (${row.code})` : ''}: {row.reason}
                </div>
              ))}
            </div>
          )}
          {result.dry_run && result.counts.skipped === 0 && (
            <div className="xsmall muted">Nothing has been written yet. Choose Import to apply it.</div>
          )}
        </Card>
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Supervisors: the stations and departments each one answers for              */
/*                                                                            */
/* This is what the auto-assignment engine reads. A supervisor has one primary */
/* posting and one primary department, and any number of further links - which */
/* is how a section SSE, or a Station Manager who answers for two departments, */
/* is represented without duplicating the person.                              */
/* -------------------------------------------------------------------------- */

function SupervisorLinks() {
  const toast = useToast();
  const { can, masters } = useAuth();
  const [list, setList] = useState<Supervisor[]>([]);
  const [term, setTerm] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Supervisor | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [busy, setBusy] = useState(false);
  const editable = can('admin');

  const loadList = useCallback(() => {
    api.get<{ data: Supervisor[] }>('/masters/supervisors', { q: term || undefined, limit: 300 })
      .then((r) => setList(r.data))
      .catch(() => setList([]));
  }, [term]);

  useEffect(loadList, [loadList]);

  useEffect(() => {
    api.get<{ data: Station[] }>('/masters/stations', { limit: 300 })
      .then((r) => setStations(r.data))
      .catch(() => setStations([]));
  }, []);

  const loadDetail = useCallback(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api.get<Supervisor>(`/masters/supervisors/${selectedId}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId]);

  useEffect(loadDetail, [loadDetail]);

  const refresh = () => {
    loadDetail();
    loadList();
  };

  const addLink = async (kind: 'stations' | 'departments', id: number) => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.post(`/admin/masters/supervisor_${kind}`, {
        supervisor_id: detail.id,
        [kind === 'stations' ? 'station_id' : 'department_id']: id,
        is_primary: 0,
        priority: 50,
        active: 1,
      });
      toast.success(kind === 'stations' ? 'Station linked' : 'Department linked');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not add the link');
    } finally {
      setBusy(false);
    }
  };

  const removeLink = async (kind: 'stations' | 'departments', linkId: number) => {
    setBusy(true);
    try {
      await api.del(`/admin/masters/supervisor_${kind}/${linkId}`);
      toast.success('Link removed - past observations keep their assignment');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove the link');
    } finally {
      setBusy(false);
    }
  };

  const linkedStationIds = new Set((detail?.stations ?? []).map((l) => l.station_id));
  const linkedDepartmentIds = new Set((detail?.departments ?? []).map((l) => l.department_id));

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <Banner tone="info" icon="users">
        The engine that picks the concerned supervisor reads these links: station + department (+ unit) identifies the
        person, so the inspector never types a mobile number. A link is deactivated rather than deleted, because
        observations already assigned keep pointing at it.
      </Banner>

      <input
        className="input"
        placeholder="Search supervisor by name, employee ID or designation"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />

      <div className="grid grid--2">
        <Card title={`Supervisors (${list.length})`} pad={false}>
          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
            {list.map((sup) => (
              <button
                key={sup.id}
                type="button"
                className={`pick-row${selectedId === sup.id ? ' pick-row--on' : ''}`}
                onClick={() => setSelectedId(sup.id)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="small strong truncate">{sup.name}</span>
                  <span className="xsmall muted truncate" style={{ display: 'block' }}>
                    {[sup.designation, sup.department_name].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="xsmall muted">
                  {sup.station_count ?? 0} stn · {sup.department_count ?? 0} dept
                </span>
              </button>
            ))}
            {list.length === 0 && <EmptyState icon="users" title="No supervisor matches" />}
          </div>
        </Card>

        {!detail ? (
          <Card>
            <EmptyState
              icon="user"
              title="Select a supervisor"
              text="Their stations and departments appear here, and the assignment engine follows whatever is set."
            />
          </Card>
        ) : (
          <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            <Card title={detail.name} subtitle={[detail.designation, detail.employee_id].filter(Boolean).join(' · ')}>
              <dl className="kv">
                <dt>Primary department</dt><dd>{detail.department_name}</dd>
                <dt>Primary posting</dt><dd>{detail.station_name ?? 'Not set'}</dd>
                {detail.mobile && (<><dt>Mobile</dt><dd className="mono-num">{detail.mobile}</dd></>)}
                {detail.area_of_responsibility && (
                  <><dt>Area of responsibility</dt><dd>{detail.area_of_responsibility}</dd></>
                )}
                {detail.reporting_officer_name && (
                  <><dt>Reports to</dt><dd>{detail.reporting_officer_name}</dd></>
                )}
              </dl>
            </Card>

            <Card title="Stations answered for" icon="station" subtitle={`${detail.stations?.length ?? 0} linked`}>
              <div className="row row--wrap" style={{ gap: 6, marginBottom: editable ? 12 : 0 }}>
                {(detail.stations ?? []).map((link) => (
                  <span key={link.station_id} className="tag">
                    {link.station_name} ({link.station_code})
                    {link.is_primary && <Badge tone="accent">Posting</Badge>}
                    {editable && !link.is_primary && link.id && (
                      <button
                        type="button"
                        className="tag__x"
                        aria-label={`Remove ${link.station_name}`}
                        disabled={busy}
                        onClick={() => void removeLink('stations', link.id as number)}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    )}
                  </span>
                ))}
                {(detail.stations ?? []).length === 0 && (
                  <span className="xsmall muted">No station linked - this supervisor is only found through the department.</span>
                )}
              </div>
              {editable && (
                <Field label="Add a station" hint="Every station on the section this supervisor covers">
                  <SearchSelect
                    options={stations
                      .filter((st) => !linkedStationIds.has(st.id))
                      .map((st) => ({
                        value: st.id,
                        label: `${st.name} (${st.code})`,
                        sub: st.section ?? undefined,
                        keywords: st.code,
                      }))}
                    value={null}
                    onChange={(value) => value && void addLink('stations', Number(value))}
                    placeholder="Select a station to link"
                    searchPlaceholder="Search stations"
                  />
                </Field>
              )}
            </Card>

            <Card title="Departments answered for" icon="users" subtitle={`${detail.departments?.length ?? 0} linked`}>
              <div className="row row--wrap" style={{ gap: 6, marginBottom: editable ? 12 : 0 }}>
                {(detail.departments ?? []).map((link) => (
                  <span key={link.department_id} className="tag">
                    {link.department_name}
                    {link.is_primary && <Badge tone="accent">Primary</Badge>}
                    {editable && !link.is_primary && link.id && (
                      <button
                        type="button"
                        className="tag__x"
                        aria-label={`Remove ${link.department_name}`}
                        disabled={busy}
                        onClick={() => void removeLink('departments', link.id as number)}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {editable && (
                <Field
                  label="Also answers for"
                  hint="A second department ranks just below the people whose department it is"
                >
                  <SearchSelect
                    options={(masters?.departments ?? [])
                      .filter((d: Department) => !linkedDepartmentIds.has(d.id))
                      .map((d: Department) => ({ value: d.id, label: d.name, sub: d.code }))}
                    value={null}
                    onChange={(value) => value && void addLink('departments', Number(value))}
                    placeholder="Select a department to link"
                    searchPlaceholder="Search departments"
                  />
                </Field>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

interface UserRow {
  id: number; employee_id: string; name: string; designation: string | null; role: string;
  email: string | null; mobile: string | null; active: number; last_login_at: string | null;
  department_name: string | null; division_name: string | null; station_name: string | null;
  supervisor_records: number; must_change_password: number;
}

function Users() {
  const toast = useToast();
  const { can, masters } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ data: UserRow[] }>('/admin/users', { q: term || undefined, limit: 300 })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [term]);

  useEffect(load, [load]);

  const resetPassword = async (row: UserRow) => {
    try {
      const response = await api.post<{ temporary_password: string }>(`/admin/users/${row.id}/reset-password`);
      toast.success(`Temporary password for ${row.name}: ${response.temporary_password}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not reset the password');
    }
  };

  const toggleActive = async (row: UserRow) => {
    try {
      await api.patch(`/admin/users/${row.id}`, { active: !row.active });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the user');
    }
  };

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Search users" value={term} onChange={(e) => setTerm(e.target.value)} />
        {can('admin') && <Button icon="plus" onClick={() => setCreating(true)}>Add user</Button>}
      </div>

      <Card pad={false}>
        {loading ? (
          <div className="card__body"><Loading /></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Employee</th><th>Role</th><th>Posting</th><th>Contact</th><th>Last login</th><th>Status</th>{can('admin') && <th />}</tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="small strong">{u.name}</span>
                      <div className="xsmall muted">{u.employee_id} · {u.designation ?? '-'}</div>
                    </td>
                    <td><Badge tone={u.role === 'admin' ? 'critical' : u.role === 'supervisor' ? 'info' : 'accent'}>{titleCase(u.role)}</Badge></td>
                    <td className="xsmall">
                      {u.department_name ?? '-'}
                      <div className="muted">{[u.station_name, u.division_name].filter(Boolean).join(' · ')}</div>
                      {u.supervisor_records > 0 && <Badge tone="outline">Supervisor record</Badge>}
                    </td>
                    <td className="xsmall">{u.email}<div className="muted">{u.mobile}</div></td>
                    <td className="xsmall">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}</td>
                    <td>
                      {u.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                      {!!u.must_change_password && <div><Badge tone="warning">Must change password</Badge></div>}
                    </td>
                    {can('admin') && (
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <Button size="sm" variant="ghost" onClick={() => void resetPassword(u)}>Reset</Button>
                          <Button size="sm" variant="ghost" onClick={() => void toggleActive(u)}>
                            {u.active ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <Sheet
          title="Add user"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="quiet" onClick={() => setCreating(false)}>Cancel</Button>
              <Button form="user-form" type="submit">Create</Button>
            </>
          }
        >
          <form
            id="user-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const payload = Object.fromEntries(
                [...form.entries()].filter(([, v]) => String(v).trim() !== '')
              );
              try {
                const created = await api.post<{ temporary_password?: string; employee_id: string }>('/admin/users', payload);
                toast.success(
                  created.temporary_password
                    ? `${created.employee_id} created. Temporary password: ${created.temporary_password}`
                    : `${created.employee_id} created`
                );
                setCreating(false);
                load();
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : 'Could not create the user');
              }
            }}
          >
            <Field label="Employee ID" required><input className="input" name="employee_id" required /></Field>
            <Field label="Name" required><input className="input" name="name" required /></Field>
            <Field label="Designation"><input className="input" name="designation" /></Field>
            <Field label="Role" required>
              <div className="select-wrap">
                <select className="select" name="role" defaultValue="inspector">
                  {['admin', 'divisional_officer', 'inspector', 'supervisor', 'viewer'].map((r) => (
                    <option key={r} value={r}>{titleCase(r)}</option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Email"><input className="input" name="email" type="email" /></Field>
            <Field label="Mobile"><input className="input" name="mobile" /></Field>
            <Field label="Department">
              <div className="select-wrap">
                <select className="select" name="department_id" defaultValue="">
                  <option value="">-</option>
                  {(masters?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </Field>
            <Field label="Division">
              <div className="select-wrap">
                <select className="select" name="division_id" defaultValue="">
                  <option value="">-</option>
                  {(masters?.divisions ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </Field>
            <Banner tone="info">
              A temporary password is generated and shown once. The user must change it at first sign-in.
            </Banner>
          </form>
        </Sheet>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

interface SettingRow { key: string; value: string | null; value_type: string; label: string | null; category: string | null }

function Settings() {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<{ data: SettingRow[] }>('/admin/settings')
      .then((r) => {
        setRows(r.data);
        setDraft(Object.fromEntries(r.data.map((s) => [s.key, s.value ?? ''])));
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const grouped = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    for (const row of rows) {
      const key = row.category ?? 'general';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  if (loading) return <Loading />;

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <Banner tone="info">
        TDC reminder rules, notification rules and the escalation hierarchy are master data - edit them under
        <strong> Master data</strong> (TDC rule, Notification rule, Escalation level).
      </Banner>

      {grouped.map(([category, settings]) => (
        <Card key={category} title={titleCase(category)} icon="settings">
          {settings.map((s) => (
            <Field key={s.key} label={s.label ?? s.key} hint={s.key}>
              {s.value_type === 'boolean' ? (
                <div className="select-wrap">
                  <select
                    className="select"
                    value={draft[s.key] ?? 'false'}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                    disabled={!can('admin')}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              ) : (
                <input
                  className="input"
                  type={s.value_type === 'number' ? 'number' : 'text'}
                  value={draft[s.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                  disabled={!can('admin')}
                />
              )}
            </Field>
          ))}
        </Card>
      ))}

      {can('admin') && (
        <Button
          onClick={async () => {
            try {
              await api.put('/admin/settings', { values: draft });
              toast.success('Settings saved');
              load();
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : 'Could not save the settings');
            }
          }}
        >
          Save settings
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                */
/* -------------------------------------------------------------------------- */

interface AuditRow {
  id: number; created_at: string; user_name: string; role: string; action: string;
  entity_type: string | null; entity_id: string | null; remarks: string | null;
  previous_value: unknown; new_value: unknown; ip: string | null;
}

function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<AuditRow | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<{ data: AuditRow[]; total: number; total_pages: number; actions: string[] }>('/admin/audit', {
      action: action || undefined, q: term || undefined, page, page_size: 40,
    })
      .then((r) => {
        setRows(r.data);
        setActions(r.actions);
        setTotals({ total: r.total, pages: r.total_pages });
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [action, term, page]);

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <div className="row row--wrap" style={{ gap: 8 }}>
        <input className="input" style={{ flex: '1 1 200px' }} placeholder="Search user, action or remarks" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} />
        <div className="select-wrap" style={{ flex: '1 1 180px' }}>
          <select className="select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
          </select>
        </div>
        {exportReport ? (
          <Button variant="ghost" icon="download" onClick={() => exportReport?.('/reports/audit', { limit: 5000 })}>
            Export
          </Button>
        ) : (
          <a className="btn btn--ghost" href={reportUrl('/reports/audit', { format: 'xlsx', limit: 5000 })}>
            <Icon name="download" size={15} /> Export
          </a>
        )}
      </div>

      <Card pad={false}>
        {loading && rows.length === 0 ? (
          <div className="card__body"><Loading /></div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Remarks</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="xsmall">{formatDateTime(row.created_at)}</td>
                      <td className="xsmall">{row.user_name}<div className="muted">{titleCase(row.role ?? '')}</div></td>
                      <td className="xsmall"><Badge tone="outline">{titleCase(row.action)}</Badge></td>
                      <td className="xsmall">{row.entity_type}{row.entity_id ? ` #${row.entity_id}` : ''}</td>
                      <td className="xsmall" style={{ maxWidth: 260 }}><span className="clamp-2">{row.remarks ?? '-'}</span></td>
                      <td>
                        {Boolean(row.previous_value ?? row.new_value) && (
                          <Button size="sm" variant="ghost" onClick={() => setOpen(row)}>Values</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={totals.pages} total={totals.total} onPage={setPage} />
          </>
        )}
      </Card>

      {open && (
        <Sheet
          title={titleCase(open.action)}
          subtitle={`${open.entity_type} #${open.entity_id} · ${formatDateTime(open.created_at)} · ${open.user_name}`}
          onClose={() => setOpen(null)}
          wide
        >
          <div className="grid grid--2">
            <div>
              <div className="section-label">Previous value</div>
              <pre className="xsmall" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, overflowX: 'auto' }}>
                {JSON.stringify(open.previous_value ?? null, null, 2)}
              </pre>
            </div>
            <div>
              <div className="section-label">New value</div>
              <pre className="xsmall" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, overflowX: 'auto' }}>
                {JSON.stringify(open.new_value ?? null, null, 2)}
              </pre>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

interface Stats {
  environment: string;
  scheduler: { enabled: boolean; cron: string; timezone: string };
  notifications: { email_enabled: boolean; sms_enabled: boolean };
  session_timeout_minutes: number;
  counts: Record<string, number>;
  delivery_status: { channel: string; status: string; n: number }[];
  database_file: string;
}

function System() {
  const toast = useToast();
  const { can } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.get<Stats>('/admin/stats').then(setStats).catch(() => setStats(null));
  useEffect(() => void load(), []);

  if (!stats) return <Loading />;

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <div className="grid grid--wide">
        <Card title="Configuration" icon="settings">
          <dl className="kv">
            <dt>Environment</dt><dd>{stats.environment}</dd>
            <dt>Session timeout</dt><dd>{stats.session_timeout_minutes} minutes</dd>
            <dt>TDC sweep</dt>
            <dd>
              {stats.scheduler.enabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}
              <div className="xsmall muted">{stats.scheduler.cron} ({stats.scheduler.timezone})</div>
            </dd>
            <dt>Email channel</dt><dd>{stats.notifications.email_enabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}</dd>
            <dt>SMS channel</dt><dd>{stats.notifications.sms_enabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}</dd>
          </dl>
        </Card>

        <Card title="Record counts" icon="chart">
          <div className="grid grid--2" style={{ gap: 6 }}>
            {Object.entries(stats.counts).map(([table, count]) => (
              <div key={table} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="xsmall muted">{table.replace(/_/g, ' ')}</span>
                <span className="small strong mono-num">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Notification delivery" icon="send">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Channel</th><th>Status</th><th className="num">Count</th></tr></thead>
              <tbody>
                {stats.delivery_status.map((d, i) => (
                  <tr key={i}>
                    <td>{titleCase(d.channel)}</td>
                    <td>
                      <Badge tone={d.status === 'sent' ? 'good' : d.status === 'failed' ? 'critical' : 'neutral'}>
                        {titleCase(d.status)}
                      </Badge>
                    </td>
                    <td className="num">{d.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {can('admin') && (
          <Card title="Operations" icon="refresh">
            <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
              <div>
                <Button
                  icon="clock"
                  loading={busy === 'sweep'}
                  onClick={async () => {
                    setBusy('sweep');
                    try {
                      const summary = await api.post<Record<string, number>>('/admin/scheduler/run', {});
                      toast.success(
                        `TDC sweep: ${summary.before_due} pre-due, ${summary.on_due} due today, ${summary.overdue} overdue, ${summary.escalated} escalated`
                      );
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : 'Sweep failed');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Run TDC reminder &amp; escalation sweep
                </Button>
                <div className="field__hint">Normally runs automatically every day at the configured time.</div>
              </div>
              <div>
                <Button
                  variant="quiet"
                  icon="download"
                  loading={busy === 'backup'}
                  onClick={async () => {
                    setBusy('backup');
                    try {
                      const response = await api.post<{ file: string }>('/admin/backup', {});
                      toast.success(`Backup written: ${response.file}`);
                    } catch (err) {
                      toast.error(err instanceof ApiError ? err.message : 'Backup failed');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Take a database backup
                </Button>
                <div className="field__hint">Writes a consistent snapshot to the server data directory.</div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* What the people using this application have said about it                  */
/* -------------------------------------------------------------------------- */

const FEEDBACK_TONE: Record<FeedbackStatus, string> = {
  new: 'warning', noted: 'accent', planned: 'accent', done: 'good', declined: 'neutral',
};
const FEEDBACK_LABEL: Record<FeedbackStatus, string> = {
  new: 'New', noted: 'Read', planned: 'Planned', done: 'Done', declined: 'Not taken up',
};

/**
 * The suggestions the inspectors and supervisors have sent in, mostly from the
 * end of an inspection. The office answers on the record; it never edits what
 * was said, so an officer can see their own words and the reply beside them.
 */
function FeedbackInbox() {
  const toast = useToast();
  const [payload, setPayload] = useState<FeedbackPayload | null>(null);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState<Feedback | null>(null);
  const [response, setResponse] = useState('');
  const [nextStatus, setNextStatus] = useState<FeedbackStatus>('noted');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<FeedbackPayload>('/profile/feedback', { status: status || undefined, limit: 200 })
      .then(setPayload)
      .catch(() => setPayload(null))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(load, [load]);

  const answer = async () => {
    if (!answering) return;
    setBusy(true);
    try {
      await api.patch(`/profile/feedback/${answering.id}`, {
        status: nextStatus,
        response: response.trim() || undefined,
      });
      toast.success(`${answering.user_name ?? 'The officer'} will see your reply`);
      setAnswering(null);
      setResponse('');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the reply');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !payload) return <Loading label="Loading feedback" />;
  const summary = payload?.summary;

  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      {summary && (
        <div className="grid grid--tiles">
          <Card pad><div className="small muted">Received</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{summary.total}</div></Card>
          <Card pad><div className="small muted">Still open</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{summary.open}</div></Card>
          <Card pad><div className="small muted">Suggestions</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{summary.by_kind.suggestion}</div></Card>
          <Card pad><div className="small muted">Problems</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{summary.by_kind.problem}</div></Card>
        </div>
      )}

      <div className="chips">
        <button className={`chip${!status ? ' chip--on' : ''}`} onClick={() => setStatus('')}>All</button>
        {(payload?.statuses ?? []).map((s) => (
          <button key={s} className={`chip${status === s ? ' chip--on' : ''}`} onClick={() => setStatus(s)}>
            {FEEDBACK_LABEL[s]}
            {summary && <span className="muted mono-num"> ({summary.by_status[s]})</span>}
          </button>
        ))}
      </div>

      <Card
        title="From the people using it"
        subtitle="Asked at the end of an inspection, and from the profile screen"
        icon="edit"
        pad={false}
      >
        {(payload?.data.length ?? 0) === 0 ? (
          <div style={{ padding: 14 }}>
            <EmptyState icon="check" title="Nothing here" text="No suggestions match this filter." />
          </div>
        ) : (
          <div>
            {payload!.data.map((f) => (
              <div className="sheet-row" key={f.id}>
                <div className="row row--wrap" style={{ gap: 6 }}>
                  <Badge tone={FEEDBACK_TONE[f.status]}>{FEEDBACK_LABEL[f.status]}</Badge>
                  <Badge tone="outline">{titleCase(f.kind)}</Badge>
                  {f.area && <Badge tone="outline">{f.area}</Badge>}
                  <span className="spacer" />
                  <span className="xsmall muted">{formatDateTime(f.created_at)}</span>
                </div>
                <div className="small" style={{ marginTop: 5 }}>{f.suggestion}</div>
                <div className="xsmall muted" style={{ marginTop: 4 }}>
                  <Icon name="user" size={11} /> {f.user_name ?? 'Unknown'}
                  {f.user_designation ? `, ${f.user_designation}` : ''}
                  {f.inspection_ref ? ` · during ${f.inspection_ref}` : ''}
                </div>
                {f.response && (
                  <div className="xsmall" style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--accent)' }}>
                    <strong>{f.responded_by_name ?? 'The office'}:</strong> {f.response}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="quiet"
                  icon="send"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setAnswering(f);
                    setResponse(f.response ?? '');
                    setNextStatus(f.status === 'new' ? 'noted' : f.status);
                  }}
                >
                  {f.response ? 'Change the reply' : 'Reply'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {answering && (
        <Sheet
          title="Reply"
          subtitle={`${answering.user_name ?? 'An officer'} · ${answering.area ?? titleCase(answering.kind)}`}
          onClose={() => setAnswering(null)}
          footer={
            <>
              <Button variant="quiet" onClick={() => setAnswering(null)}>Cancel</Button>
              <Button loading={busy} onClick={answer}>Save the reply</Button>
            </>
          }
        >
          <Banner tone="info">
            What the officer wrote stays as it is. Your reply and the status are added beside it, and they see
            both on their profile screen.
          </Banner>
          <p className="small" style={{ margin: '12px 0' }}>{answering.suggestion}</p>
          <Field label="Where it stands">
            <div className="chips">
              {(payload?.statuses ?? []).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${nextStatus === s ? ' chip--on' : ''}`}
                  onClick={() => setNextStatus(s)}
                >
                  {FEEDBACK_LABEL[s]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Reply" hint="Optional - but an officer who hears nothing stops suggesting things">
            <textarea
              className="textarea"
              style={{ minHeight: 90 }}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          </Field>
        </Sheet>
      )}
    </div>
  );
}
