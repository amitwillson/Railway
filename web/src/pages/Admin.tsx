import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError, reportUrl } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import Icon from '../components/Icon';
import {
  Badge, Banner, Button, Card, EmptyState, Field, Loading, Pager, Sheet, Tabs,
} from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';

type Tab = 'masters' | 'users' | 'settings' | 'audit' | 'system';

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
          { key: 'users', label: 'Users' },
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
      {tab === 'users' && <Users />}
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
        action={editable ? <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add</Button> : undefined}
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
        <a className="btn btn--ghost" href={reportUrl('/reports/audit', { format: 'xlsx', limit: 5000 })}>
          <Icon name="download" size={15} /> Export
        </a>
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
