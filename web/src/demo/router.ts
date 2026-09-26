/**
 * Request router for the offline demonstration build.
 *
 * It answers the same URLs, accepts the same parameters and returns the same
 * shapes as the real API, so every screen runs unmodified. Writes are applied
 * to the in-memory store: assignment, notification, repeat detection, the
 * timeline and the audit trail all happen for real, and a page reload restores
 * the seeded dataset.
 */
import {
  byId, dateOnly, images, insert, inspections, isOpenStatus, meta, nowIso,
  observations, publicUser, table, todayIso, update, uuid, viewInspection,
  viewObservation, where, type Row,
} from './store';
import { audit, autoAssign, dispatch, findRepeats, findSupervisors, observationById, timeline } from './engines';

export class DemoError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const bad = (message: string, details?: unknown) => new DemoError(400, 'BAD_REQUEST', message, details);
const forbidden = (message: string) => new DemoError(403, 'FORBIDDEN', message);
const notFound = (what: string) => new DemoError(404, 'NOT_FOUND', `${what} not found`);

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

interface Session { token: string; userId: number; issuedAt: string }
const sessions = new Map<string, Session>();

const sessionUser = (token: string | null): Row => {
  const session = token ? sessions.get(token) : null;
  const user = session ? byId('users', session.userId) : null;
  if (!user) throw new DemoError(401, 'UNAUTHORIZED', 'Your session has ended. Please sign in again.');
  return user;
};

const isAdmin = (user: Row) => user.role === 'admin';
const isOfficer = (user: Row) => user.role === 'divisional_officer' || isAdmin(user);

const CAPABILITIES: Record<string, string[]> = {
  admin: ['*'],
  divisional_officer: [
    'inspection:read', 'inspection:create', 'inspection:update', 'observation:read',
    'observation:create', 'observation:update', 'observation:verify', 'observation:cancel',
    'compliance:read', 'dashboard:read', 'report:read', 'master:read', 'supervisor:read',
    'audit:read', 'notification:read',
  ],
  inspector: [
    'inspection:read', 'inspection:create', 'inspection:update', 'observation:read',
    'observation:create', 'observation:update', 'observation:verify', 'compliance:read',
    'dashboard:read', 'report:read', 'master:read', 'supervisor:read', 'notification:read',
  ],
  supervisor: [
    'inspection:read', 'observation:read', 'compliance:read', 'compliance:submit',
    'observation:acknowledge', 'dashboard:read', 'report:read', 'master:read',
    'supervisor:read', 'notification:read',
  ],
  viewer: [
    'inspection:read', 'observation:read', 'compliance:read', 'dashboard:read',
    'report:read', 'master:read', 'supervisor:read', 'notification:read',
  ],
};

const can = (user: Row, capability: string) => {
  const list = CAPABILITIES[user.role] ?? [];
  return list.includes('*') || list.includes(capability);
};

const require_ = (user: Row, capability: string) => {
  if (!can(user, capability)) {
    throw forbidden(`Your role (${user.role}) cannot perform "${capability}"`);
  }
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const num = (value: string | null): number | undefined => {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const bool = (value: string | null): boolean | undefined => {
  if (value === null) return undefined;
  const s = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
  return undefined;
};

const page = <T>(rows: T[], q: URLSearchParams, defaultSize = 25) => {
  const pageNo = Math.max(1, num(q.get('page')) ?? 1);
  const size = Math.min(200, Math.max(1, num(q.get('page_size')) ?? defaultSize));
  return {
    data: rows.slice((pageNo - 1) * size, pageNo * size),
    page: pageNo,
    page_size: size,
    total: rows.length,
    total_pages: Math.max(1, Math.ceil(rows.length / size)),
  };
};

const contains = (haystack: unknown, needle: string) =>
  String(haystack ?? '').toLowerCase().includes(needle);

/** The access scope a role has over observations. */
function inScope(o: Row, user: Row): boolean {
  if (isAdmin(user)) return true;
  if (user.role === 'supervisor') {
    const sup = table('supervisors').find((s) => s.user_id === user.id);
    if (sup && o.supervisor_id === sup.id) return true;
    const deptId = sup?.department_id ?? user.department_id;
    const stationId = sup?.station_id ?? user.station_id;
    if (deptId && stationId) return o.action_by_department_id === deptId && o.station_id === stationId;
    if (deptId) return o.action_by_department_id === deptId;
    return o.created_by === user.id;
  }
  if (user.division_id) {
    if (o.created_by === user.id) return true;
    if (o.station_id == null) return true;
    return byId('stations', o.station_id)?.division_id === user.division_id;
  }
  return true;
}

const SORTS: Record<string, (a: Row, b: Row) => number> = {
  newest: (a, b) => String(b.observed_at).localeCompare(String(a.observed_at)),
  oldest: (a, b) => String(a.observed_at).localeCompare(String(b.observed_at)),
  tdc: (a, b) => (a.tdc ? 0 : 1) - (b.tdc ? 0 : 1) || String(a.tdc ?? '').localeCompare(String(b.tdc ?? '')),
  severity: (a, b) => a.severity_rank - b.severity_rank || String(b.observed_at).localeCompare(String(a.observed_at)),
  overdue: (a, b) => Number(b.is_overdue) - Number(a.is_overdue) || (a.days_to_tdc ?? 99) - (b.days_to_tdc ?? 99),
  status: (a, b) => String(a.status).localeCompare(String(b.status)) || String(b.observed_at).localeCompare(String(a.observed_at)),
};

/** The shared observation filter, matching the server's query builder. */
function filterObservations(q: URLSearchParams, user: Row): Row[] {
  const status = q.get('status')?.split(',').map((s) => s.trim()).filter(Boolean);
  const search = q.get('q')?.toLowerCase();
  const mySupervisorId = table('supervisors').find((s) => s.user_id === user.id)?.id ?? null;

  const rows = observations().filter((o) => {
    if (!inScope(o, user)) return false;
    const eq = (key: string, param: string) => {
      const value = num(q.get(param));
      return value === undefined || o[key] === value;
    };
    if (!eq('station_id', 'station_id')) return false;
    if (!eq('train_id', 'train_id')) return false;
    if (!eq('module_id', 'module_id')) return false;
    if (!eq('action_by_department_id', 'department_id')) return false;
    if (!eq('supervisor_id', 'supervisor_id')) return false;
    if (!eq('severity_id', 'severity_id')) return false;
    if (!eq('category_id', 'category_id')) return false;
    if (!eq('item_id', 'item_id')) return false;
    if (!eq('unit_id', 'unit_id')) return false;
    if (!eq('inspection_id', 'inspection_id')) return false;
    if (!eq('created_by', 'created_by')) return false;
    const moduleCode = q.get('module_code');
    if (moduleCode && o.module_code !== moduleCode) return false;
    const divisionId = num(q.get('division_id'));
    if (divisionId !== undefined && o.division_id !== divisionId) return false;
    if (status?.length && !status.includes(o.status)) return false;
    if (bool(q.get('open')) === true && !o.is_open) return false;
    if (bool(q.get('closed')) === true && o.status !== 'closed') return false;
    if (bool(q.get('overdue')) === true && !o.is_overdue) return false;
    if (bool(q.get('due_soon')) === true && !(o.is_open && o.days_to_tdc !== null && o.days_to_tdc >= 0 && o.days_to_tdc <= 3)) return false;
    if (bool(q.get('awaiting_verification')) === true && o.status !== 'compliance_submitted') return false;
    if (bool(q.get('repeated')) === true && !(o.repeat_count > 0)) return false;
    if (bool(q.get('critical')) === true && o.severity_rank !== 1) return false;
    const hasTdc = bool(q.get('has_tdc'));
    if (hasTdc === true && !o.tdc) return false;
    if (hasTdc === false && o.tdc) return false;
    if (bool(q.get('mine')) === true && o.created_by !== user.id) return false;
    if (bool(q.get('assigned_to_me')) === true) {
      if (mySupervisorId) {
        if (o.supervisor_id !== mySupervisorId) return false;
      } else if (user.department_id) {
        if (o.action_by_department_id !== user.department_id) return false;
      } else {
        return false;
      }
    }
    const from = q.get('from');
    if (from && dateOnly(o.observed_at)! < from) return false;
    const to = q.get('to');
    if (to && dateOnly(o.observed_at)! > to) return false;
    const tdcFrom = q.get('tdc_from');
    if (tdcFrom && (!o.tdc || o.tdc < tdcFrom)) return false;
    const tdcTo = q.get('tdc_to');
    if (tdcTo && (!o.tdc || o.tdc > tdcTo)) return false;
    const days = num(q.get('days'));
    if (days !== undefined && Date.parse(o.observed_at) < Date.now() - days * 86_400_000) return false;
    if (search) {
      const haystack = [
        o.ref_no, o.observation, o.item_name, o.unit_name, o.station_name,
        o.station_code, o.supervisor_name, o.train_number, o.inspector_name,
      ];
      if (!haystack.some((field) => contains(field, search))) return false;
    }
    return true;
  });

  return rows.sort(SORTS[q.get('sort') ?? 'newest'] ?? SORTS.newest);
}

/* -------------------------------------------------------------------------- */
/* Route table                                                                */
/* -------------------------------------------------------------------------- */

type Handler = (ctx: {
  params: string[];
  q: URLSearchParams;
  body: any;
  user: Row;
  method: string;
}) => unknown;

interface Route { method: string; pattern: RegExp; handler: Handler; anonymous?: boolean }

const routes: Route[] = [];
const on = (method: string, path: string, handler: Handler, anonymous = false) => {
  const pattern = new RegExp(`^${path.replace(/:[a-z_]+/g, '([^/]+)')}$`);
  routes.push({ method, pattern, handler, anonymous });
};

/* ------------------------------- auth ------------------------------------- */

on('POST', '/auth/login', ({ body }) => {
  const identifier = String(body?.identifier ?? '').trim().toLowerCase();
  const user = table('users').find(
    (u) => String(u.employee_id).toLowerCase() === identifier ||
      String(u.email ?? '').toLowerCase() === identifier ||
      String(u.mobile ?? '') === identifier
  );
  if (!user) throw new DemoError(401, 'UNAUTHORIZED', 'Invalid credentials');
  if (String(body?.password ?? '') !== meta.seed_password) {
    throw new DemoError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }
  if (!user.active) throw forbidden('This account has been deactivated');
  const token = `demo-${uuid()}`;
  sessions.set(token, { token, userId: user.id, issuedAt: nowIso() });
  update('users', user.id, { last_login_at: nowIso() });
  return {
    token,
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    user: publicUser(user),
  };
}, true);

on('POST', '/auth/otp/request', ({ body }) => {
  const identifier = String(body?.identifier ?? '').trim().toLowerCase();
  const user = table('users').find((u) => String(u.employee_id).toLowerCase() === identifier);
  return {
    sent: true,
    channel: user?.mobile ? 'sms' : 'email',
    target: user?.mobile ? `******${String(user.mobile).slice(-4)}` : user?.email,
    expires_in_minutes: 10,
    dev_otp: '123456',
  };
}, true);

on('POST', '/auth/otp/verify', ({ body }) => {
  if (String(body?.code ?? '') !== '123456') throw bad('Incorrect OTP');
  const identifier = String(body?.identifier ?? '').trim().toLowerCase();
  const user = table('users').find((u) => String(u.employee_id).toLowerCase() === identifier);
  if (!user) throw new DemoError(401, 'UNAUTHORIZED', 'Invalid credentials');
  const token = `demo-${uuid()}`;
  sessions.set(token, { token, userId: user.id, issuedAt: nowIso() });
  return { token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), user: publicUser(user) };
}, true);

on('GET', '/auth/demo-users', () => ({
  password: meta.seed_password,
  data: table('users')
    .filter((u) => u.active)
    .sort((a, b) => {
      const order = ['admin', 'divisional_officer', 'inspector', 'supervisor', 'viewer'];
      return order.indexOf(a.role) - order.indexOf(b.role) || String(a.name).localeCompare(String(b.name));
    })
    .slice(0, 40)
    .map((u) => ({
      employee_id: u.employee_id,
      name: u.name,
      role: u.role,
      designation: u.designation,
      department: byId('departments', u.department_id)?.name ?? null,
    })),
}), true);

on('GET', '/auth/me', ({ user }) => ({
  user: publicUser(user),
  unread_notifications: where('notifications', (n) => n.user_id === user.id && !n.read_at).length,
  session_timeout_minutes: 60,
}));

on('POST', '/auth/logout', () => ({ ok: true }));

on('GET', '/auth/sessions', ({ user }) => ({
  data: [...sessions.values()]
    .filter((s) => s.userId === user.id)
    .map((s) => ({
      id: s.token,
      issued_at: s.issuedAt,
      expires_at: new Date(Date.parse(s.issuedAt) + 3_600_000).toISOString(),
      last_seen_at: nowIso(),
      ip: '127.0.0.1',
      user_agent: 'Offline demonstration build',
      revoked_at: null,
      current: true,
    })),
}));

on('DELETE', '/auth/sessions/:id', ({ params }) => {
  sessions.delete(params[0]!);
  return { ok: true };
});

on('POST', '/auth/change-password', () => {
  throw bad('Passwords cannot be changed in the offline demonstration build.');
});

/* ------------------------------ masters ----------------------------------- */

const activeRows = (name: string) =>
  where(name, (r) => r.active !== 0).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));

on('GET', '/masters/bootstrap', () => ({
  generated_at: meta.generated_at,
  modules: activeRows('modules'),
  inspection_types: activeRows('inspection_types').map((t) => ({
    ...t,
    module_code: byId('modules', t.module_id)?.code ?? null,
  })),
  location_types: [
    'Station', 'Train', 'Platform', 'Booking Office', 'Reservation Office', 'Parcel Office',
    'Commercial Establishment', 'Circulating Area', 'Waiting Hall', 'On-Train', 'Other',
  ],
  departments: activeRows('departments'),
  observation_categories: activeRows('observation_categories'),
  severities: where('severities', (s) => s.active !== 0).sort((a, b) => a.rank - b.rank),
  item_parameters: activeRows('item_parameters'),
  item_groups: activeRows('item_groups').map((g) => ({ ...g, module_code: byId('modules', g.module_id)?.code })),
  divisions: where('divisions', (d) => d.active !== 0).map((d) => ({
    ...d,
    zone_code: byId('zones', d.zone_id)?.code,
    zone_name: byId('zones', d.zone_id)?.name,
  })),
  zones: activeRows('zones'),
  rule_references: activeRows('rule_references'),
  settings: Object.fromEntries(
    where('settings', (s) => ['general', 'workflow'].includes(s.category)).map((s) => [s.key, s.value])
  ),
  counts: {
    stations: where('stations', (s) => s.active !== 0).length,
    trains: where('trains', (t) => t.active !== 0).length,
    items: where('inspection_items', (i) => i.active !== 0).length,
    supervisors: where('supervisors', (s) => s.active !== 0).length,
  },
}));

const stationView = (s: Row): Row => ({
  ...s,
  division_name: byId('divisions', s.division_id)?.name,
  division_code: byId('divisions', s.division_id)?.code,
  zone_name: byId('zones', s.zone_id)?.name,
  zone_code: byId('zones', s.zone_id)?.code,
});

on('GET', '/masters/stations', ({ q }) => {
  const term = q.get('q')?.toLowerCase();
  const divisionId = num(q.get('division_id'));
  const limit = num(q.get('limit')) ?? 50;
  const rows = where('stations', (s) => {
    if (!s.active) return false;
    if (divisionId !== undefined && s.division_id !== divisionId) return false;
    if (term && !(contains(s.name, term) || contains(s.code, term))) return false;
    return true;
  })
    .sort((a, b) => {
      if (term) {
        const exact = (s: Row) => (String(s.code).toLowerCase() === term ? 0 : 1);
        if (exact(a) !== exact(b)) return exact(a) - exact(b);
      }
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, limit);
  return { data: rows.map(stationView) };
});

const unitsFor = (stationId: number | undefined, appliesTo: 'station' | 'train') =>
  where('units', (u) =>
    u.active &&
    (u.applies_to === appliesTo || u.applies_to === 'both') &&
    (u.station_id == null || u.station_id === stationId)
  )
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((u) => ({ ...u, station_specific: u.station_id != null }));

on('GET', '/masters/stations/:id', ({ params }) => {
  const station = byId('stations', params[0]);
  if (!station) throw notFound('Station');
  return {
    ...stationView(station),
    units: unitsFor(station.id, 'station'),
    supervisors: where('supervisors', (s) => s.active && s.station_id === station.id).map((s) => ({
      ...s,
      department_name: byId('departments', s.department_id)?.name,
    })),
  };
});

on('GET', '/masters/trains', ({ q }) => {
  const term = q.get('q')?.toLowerCase();
  const limit = num(q.get('limit')) ?? 50;
  return {
    data: where('trains', (t) => {
      if (!t.active) return false;
      if (!term) return true;
      return contains(t.name, term) || contains(t.number, term) ||
        contains(t.origin, term) || contains(t.destination, term);
    })
      .sort((a, b) => String(a.number).localeCompare(String(b.number)))
      .slice(0, limit),
  };
});

on('GET', '/masters/trains/:id', ({ params }) => {
  const train = byId('trains', params[0]);
  if (!train) throw notFound('Train');
  return { ...train, units: unitsFor(undefined, 'train') };
});

on('GET', '/masters/units', ({ q }) => {
  const stationId = num(q.get('station_id'));
  const locationType = q.get('location_type') ?? '';
  const requested = q.get('applies_to');
  const appliesTo: 'station' | 'train' =
    requested === 'train' ? 'train' : requested === 'station' ? 'station' : /train/i.test(locationType) ? 'train' : 'station';
  let data = unitsFor(stationId, appliesTo);
  if (locationType && !/^(station|train|other)$/i.test(locationType)) {
    const needle = locationType.toLowerCase();
    const matches = (u: Row) => contains(u.name, needle) || String(u.kind ?? '').toLowerCase() === needle;
    data = [...data.filter(matches), ...data.filter((u) => !matches(u))];
  }
  return { data };
});

const itemView = (i: Row): Row => ({
  ...i,
  group_name: byId('item_groups', i.group_id)?.name,
  group_sort: byId('item_groups', i.group_id)?.sort_order,
  module_code: byId('modules', i.module_id)?.code,
  default_department_name: byId('departments', i.default_department_id)?.name ?? null,
});

on('GET', '/masters/items', ({ q }) => {
  const moduleId = num(q.get('module_id'));
  const moduleCode = q.get('module_code');
  const groupId = num(q.get('group_id'));
  const appliesTo = q.get('applies_to');
  const term = q.get('q')?.toLowerCase();
  const limit = num(q.get('limit')) ?? 400;

  const rows = where('inspection_items', (i) => {
    if (!i.active) return false;
    const group = byId('item_groups', i.group_id);
    if (!group?.active) return false;
    if (moduleId !== undefined && i.module_id !== moduleId) return false;
    if (moduleCode && byId('modules', i.module_id)?.code !== moduleCode) return false;
    if (groupId !== undefined && i.group_id !== groupId) return false;
    if (appliesTo && appliesTo !== 'both' && !(i.applies_to === appliesTo || i.applies_to === 'both')) return false;
    if (term && !(contains(i.name, term) || contains(group.name, term))) return false;
    return true;
  })
    .map(itemView)
    .sort(
      (a, b) =>
        (a.group_sort ?? 0) - (b.group_sort ?? 0) ||
        String(a.group_name).localeCompare(String(b.group_name)) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )
    .slice(0, limit);

  const groups: Row[] = [];
  for (const row of rows) {
    let group = groups.find((g) => g.group_id === row.group_id);
    if (!group) {
      group = { group_id: row.group_id, group_name: row.group_name, items: [] };
      groups.push(group);
    }
    group.items.push(row);
  }
  return { data: rows, groups };
});

on('GET', '/masters/items/:id', ({ params }) => {
  const item = byId('inspection_items', params[0]);
  if (!item) throw notFound('Inspection item');
  const mapped = where('item_parameter_map', (m) => m.item_id === item.id)
    .map((m) => byId('item_parameters', m.parameter_id))
    .filter((p): p is Row => Boolean(p && p.active));
  const rule = byId('rule_references', item.rule_reference_id);
  return {
    ...itemView(item),
    module_name: byId('modules', item.module_id)?.name,
    rule_code: rule?.code,
    rule_title: rule?.title,
    parameters: mapped.length ? mapped : activeRows('item_parameters'),
    parameters_are_defaults: mapped.length === 0,
  };
});

on('GET', '/masters/supervisors', ({ q }) => {
  const term = q.get('q')?.toLowerCase();
  const departmentId = num(q.get('department_id'));
  const stationId = num(q.get('station_id'));
  return {
    data: where('supervisors', (s) => {
      if (!s.active) return false;
      if (departmentId !== undefined && s.department_id !== departmentId) return false;
      if (stationId !== undefined && !(s.station_id === stationId || s.station_id == null)) return false;
      if (term && !(contains(s.name, term) || contains(s.employee_id, term) || contains(s.designation, term))) return false;
      return true;
    }).map((s) => ({
      ...s,
      department_name: byId('departments', s.department_id)?.name,
      station_name: byId('stations', s.station_id)?.name ?? null,
      reporting_officer_name: byId('supervisors', s.reporting_officer_id)?.name ?? null,
    })),
  };
});

on('GET', '/masters/supervisors/resolve', ({ q }) => {
  const departmentId = num(q.get('department_id'));
  if (!departmentId) throw bad('department_id is required');
  const candidates = findSupervisors({
    stationId: num(q.get('station_id')),
    unitId: num(q.get('unit_id')),
    departmentId,
    itemId: num(q.get('item_id')),
  });
  return { data: candidates, auto_selected: candidates[0] ?? null, requires_choice: candidates.length > 1 };
});

on('GET', '/masters/departments', () => ({ data: activeRows('departments') }));
on('GET', '/masters/severities', () => ({
  data: where('severities', (s) => s.active !== 0).sort((a, b) => a.rank - b.rank),
}));
on('GET', '/masters/categories', () => ({ data: activeRows('observation_categories') }));
on('GET', '/masters/inspection-types', () => ({ data: activeRows('inspection_types') }));
on('GET', '/masters/parameters', () => ({ data: activeRows('item_parameters') }));
on('GET', '/masters/rule-references', () => ({ data: activeRows('rule_references') }));
on('GET', '/masters/modules', () => ({ data: activeRows('modules') }));
on('GET', '/masters/contractors', ({ q }) => {
  const stationId = num(q.get('station_id'));
  return {
    data: where('contractors', (c) => c.active && (stationId === undefined || c.station_id === stationId || c.station_id == null))
      .map((c) => ({
        ...c,
        station_name: byId('stations', c.station_id)?.name ?? null,
        department_name: byId('departments', c.department_id)?.name ?? null,
      })),
  };
});


/* ----------------------------- inspections -------------------------------- */

on('GET', '/inspections', ({ q, user }) => {
  require_(user, 'inspection:read');
  const term = q.get('q')?.toLowerCase();
  const status = q.get('status')?.split(',').map((s) => s.trim()).filter(Boolean);
  const rows = inspections()
    .filter((i) => {
      if (bool(q.get('mine')) === true && i.inspector_id !== user.id) return false;
      const eq = (key: string, param: string) => {
        const value = num(q.get(param));
        return value === undefined || i[key] === value;
      };
      if (!eq('module_id', 'module_id')) return false;
      if (!eq('station_id', 'station_id')) return false;
      if (!eq('train_id', 'train_id')) return false;
      if (!eq('inspector_id', 'inspector_id')) return false;
      if (status?.length && !status.includes(i.status)) return false;
      const from = q.get('from');
      if (from && dateOnly(i.created_at)! < from) return false;
      const to = q.get('to');
      if (to && dateOnly(i.created_at)! > to) return false;
      if (term) {
        const haystack = [i.ref_no, i.title, i.station_name, i.station_code, i.train_number, i.train_name, i.inspector_name];
        if (!haystack.some((f) => contains(f, term))) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return page(rows, q, 20);
});

on('GET', '/inspections/:id', ({ params, user }) => {
  require_(user, 'inspection:read');
  const inspection = byId('inspections', params[0]);
  if (!inspection) throw notFound('Inspection');
  return {
    ...viewInspection(inspection),
    observations: where('observations', (o) => o.inspection_id === inspection.id).map(viewObservation),
    approvals: where('approvals', (a) => a.entity_type === 'inspection' && a.entity_id === inspection.id),
    attachments: where('attachments', (a) => a.inspection_id === inspection.id && !a.observation_id),
  };
});

on('POST', '/inspections', ({ body, user }) => {
  require_(user, 'inspection:create');
  if (body?.client_uuid) {
    const existing = table('inspections').find((i) => i.client_uuid === body.client_uuid);
    if (existing) return { ...viewInspection(existing), deduplicated: true };
  }
  if (!body?.station_id && !body?.train_id && !body?.section) {
    throw bad('Select a station, a train or a section for this inspection');
  }
  const module = byId('modules', body.module_id);
  const type = byId('inspection_types', body.inspection_type_id);
  if (!module) throw bad('Unknown inspection module');
  if (!type) throw bad('Unknown inspection type');

  const created = insert('inspections', {
    ref_no: nextRefFor('inspections', 'INSP'),
    module_id: body.module_id,
    inspection_type_id: body.inspection_type_id,
    location_type: body.location_type,
    station_id: body.station_id ?? null,
    train_id: body.train_id ?? null,
    section: body.section ?? null,
    title: body.title ?? `${type.name} - ${module.name}`,
    inspector_id: user.id,
    joint_with: body.joint_with ?? null,
    planned_date: body.planned_date ?? null,
    started_at: nowIso(),
    completed_at: null,
    status: 'in_progress',
    summary: null,
    auto_summary: null,
    notes: body.notes ?? null,
    qr_token: uuid().slice(0, 20),
    client_uuid: body.client_uuid ?? null,
    created_at: nowIso(),
    updated_at: null,
  });
  audit({ action: 'INSPECTION_CREATE', entityType: 'inspection', entityId: created.id, user, next: created });
  return viewInspection(created);
});

on('PATCH', '/inspections/:id', ({ params, body, user }) => {
  require_(user, 'inspection:update');
  const inspection = byId('inspections', params[0]);
  if (!inspection) throw notFound('Inspection');
  const previous = { ...inspection };
  update('inspections', inspection.id, { ...body, updated_at: nowIso() });
  audit({ action: 'INSPECTION_UPDATE', entityType: 'inspection', entityId: inspection.id, user, previous, next: inspection });
  return viewInspection(inspection);
});

/** The automatic summary, built from the inspection's observations. */
function buildSummary(inspectionId: number) {
  const inspection = byId('inspections', inspectionId);
  if (!inspection) return null;
  const view = viewInspection(inspection);
  const rows = where('observations', (o) => o.inspection_id === inspectionId).map(viewObservation);
  const bySeverity: Record<string, number> = {};
  const byDepartment: Record<string, number> = {};
  let withTdc = 0;
  let repeated = 0;
  for (const o of rows) {
    bySeverity[o.severity_name] = (bySeverity[o.severity_name] ?? 0) + 1;
    byDepartment[o.department_name] = (byDepartment[o.department_name] ?? 0) + 1;
    if (o.tdc) withTdc += 1;
    if (o.repeat_count > 0) repeated += 1;
  }
  const place = view.station_name
    ? `${view.station_name} (${view.station_code})`
    : [view.train_number, view.train_name].filter(Boolean).join(' ') || view.section || '-';
  const parts = [
    `${view.inspection_type_name} of ${place} was carried out by ${view.inspector_name}` +
      `${view.inspector_designation ? `, ${view.inspector_designation}` : ''} on ` +
      `${String(view.started_at ?? view.created_at).slice(0, 10)}.`,
    rows.length
      ? `${rows.length} observation(s) were recorded (${Object.entries(bySeverity).map(([k, v]) => `${v} ${k}`).join(', ')}).`
      : 'No deficiency was noticed during this inspection.',
  ];
  if (Object.keys(byDepartment).length) {
    parts.push(
      `Action has been advised to: ${Object.entries(byDepartment)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}.`
    );
  }
  if (withTdc) parts.push(`${withTdc} observation(s) carry a target date of compliance.`);
  if (repeated) {
    parts.push(`${repeated} observation(s) are repeated deficiencies and need sustained attention by the concerned department.`);
  }
  const critical = rows.filter((o) => o.severity_rank === 1);
  if (critical.length) {
    parts.push(
      `Critical observation(s) requiring immediate attention: ${critical
        .map((o) => `${o.ref_no} - ${o.item_name ?? 'observation'} at ${o.unit_name ?? place}`)
        .join('; ')}.`
    );
  }
  return {
    text: parts.join(' '),
    stats: {
      total: rows.length, by_severity: bySeverity, by_department: byDepartment,
      with_tdc: withTdc, repeated, critical: critical.length,
    },
  };
}

on('GET', '/inspections/:id/summary', ({ params }) => {
  const summary = buildSummary(Number(params[0]));
  if (!summary) throw notFound('Inspection');
  return summary;
});

on('POST', '/inspections/:id/complete', ({ params, body, user }) => {
  require_(user, 'inspection:update');
  const inspection = byId('inspections', params[0]);
  if (!inspection) throw notFound('Inspection');
  if (inspection.status === 'completed') throw bad('This inspection is already completed');
  const summary = buildSummary(inspection.id);
  update('inspections', inspection.id, {
    status: 'completed',
    completed_at: nowIso(),
    summary: body?.summary ?? summary?.text ?? null,
    auto_summary: summary?.text ?? null,
    updated_at: nowIso(),
  });
  insert('approvals', {
    entity_type: 'inspection',
    entity_id: inspection.id,
    approval_role: 'inspector',
    user_id: user.id,
    user_name: user.name,
    designation: user.designation ?? null,
    remarks: body?.remarks ?? null,
    signature_data: body?.signature_data ?? null,
    signed_at: nowIso(),
  });
  audit({ action: 'INSPECTION_COMPLETE', entityType: 'inspection', entityId: inspection.id, user, next: { status: 'completed' } });
  return { ...viewInspection(inspection), auto_summary_stats: summary?.stats };
});

on('POST', '/inspections/:id/approve', ({ params, body, user }) => {
  if (!isOfficer(user)) throw forbidden('Only a divisional officer or an admin can approve');
  const inspection = byId('inspections', params[0]);
  if (!inspection) throw notFound('Inspection');
  const approval = insert('approvals', {
    entity_type: 'inspection',
    entity_id: inspection.id,
    approval_role: 'officer',
    user_id: user.id,
    user_name: user.name,
    designation: user.designation ?? null,
    remarks: body?.remarks ?? null,
    signature_data: body?.signature_data ?? null,
    signed_at: nowIso(),
  });
  return approval;
});

const nextRefFor = (name: string, prefix: string) => {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-`;
  const last = table(name)
    .map((row) => String(row.ref_no ?? ''))
    .filter((ref) => ref.startsWith(like))
    .map((ref) => Number.parseInt(ref.split('-').pop() ?? '0', 10))
    .reduce((max, n) => Math.max(max, Number.isFinite(n) ? n : 0), 0);
  return `${like}${String(last + 1).padStart(6, '0')}`;
};

/* ----------------------------- observations ------------------------------- */

on('GET', '/observations', ({ q, user }) => {
  require_(user, 'observation:read');
  return page(filterObservations(q, user), q, 25);
});

on('GET', '/observations/counters', ({ user }) => {
  const count = (query: string) => filterObservations(new URLSearchParams(query), user).length;
  return {
    my_open: count('mine=1&open=1'),
    assigned_to_me: count('assigned_to_me=1&open=1'),
    pending: count('open=1'),
    compliance_pending: count('status=assigned,acknowledged,in_progress,reopened,rejected'),
    awaiting_verification: count('awaiting_verification=1'),
    overdue: count('overdue=1'),
    critical_open: count('critical=1&open=1'),
    closed: count('closed=1'),
    repeated_open: count('repeated=1&open=1'),
  };
});

on('GET', '/observations/repeat-check', ({ q }) =>
  findRepeats({
    stationId: num(q.get('station_id')),
    trainId: num(q.get('train_id')),
    unitId: num(q.get('unit_id')),
    unitName: q.get('unit_name'),
    itemId: num(q.get('item_id')),
    itemName: q.get('item_name'),
    categoryId: num(q.get('category_id')),
    observation: q.get('observation') ?? '',
    windowDays: num(q.get('window_days')) ?? 90,
  })
);

on('POST', '/observations', ({ body, user }) => {
  require_(user, 'observation:create');
  if (body?.client_uuid) {
    const existing = table('observations').find((o) => o.client_uuid === body.client_uuid);
    if (existing) return { ...viewObservation(existing), deduplicated: true };
  }
  const inspection = byId('inspections', body?.inspection_id);
  if (!inspection) throw bad('Unknown inspection');
  if (inspection.inspector_id !== user.id && !isOfficer(user)) {
    throw forbidden('Observations can only be added by the inspecting officer of this inspection');
  }
  if (!body?.observation || String(body.observation).trim().length < 5) {
    throw bad('Validation failed', [{ path: 'observation', message: 'Describe the observation in at least 5 characters' }]);
  }
  const department = byId('departments', body?.action_by_department_id);
  if (!department) throw bad('Unknown department for "Action By"');

  const item = byId('inspection_items', body.item_id);
  const unit = byId('units', body.unit_id);
  const severityId =
    body.severity_id ?? item?.default_severity_id ??
    table('severities').find((s) => s.name === 'Moderate')?.id ??
    table('severities')[0]?.id;
  const severity = byId('severities', severityId);
  const categoryId = body.category_id ?? item?.default_category_id ?? null;

  let supervisorId: number | null = body.supervisor_id ?? null;
  let assignmentMode = body.supervisor_id ? 'manual' : 'auto';
  if (!supervisorId) {
    const auto = autoAssign({
      stationId: inspection.station_id,
      unitId: body.unit_id,
      departmentId: body.action_by_department_id,
      itemId: body.item_id,
    });
    supervisorId = auto?.id ?? null;
    if (!supervisorId) assignmentMode = 'unassigned';
  }

  const unitName = body.unit_name ?? unit?.name ?? null;
  const repeats = findRepeats({
    stationId: inspection.station_id,
    trainId: inspection.train_id,
    unitId: body.unit_id,
    unitName,
    itemId: body.item_id,
    itemName: item?.name,
    categoryId,
    observation: body.observation,
  });

  const created = insert('observations', {
    ref_no: nextRefFor('observations', 'OBS'),
    inspection_id: inspection.id,
    module_id: inspection.module_id,
    station_id: inspection.station_id ?? null,
    train_id: inspection.train_id ?? null,
    coach: body.coach ?? null,
    unit_id: body.unit_id ?? null,
    unit_name: unitName,
    item_id: body.item_id ?? null,
    item_name: item?.name ?? null,
    parameters: body.parameters?.length ? JSON.stringify(body.parameters) : null,
    observation: String(body.observation).trim(),
    category_id: categoryId,
    severity_id: severityId,
    action_by_department_id: body.action_by_department_id,
    supervisor_id: supervisorId,
    assignment_mode: assignmentMode,
    contractor_id: body.contractor_id ?? null,
    rule_reference_id: body.rule_reference_id ?? item?.rule_reference_id ?? null,
    tdc: body.tdc ?? null,
    status: supervisorId ? 'assigned' : 'submitted',
    requires_physical_verification: 0,
    repeat_count: repeats.count,
    repeat_of_id: repeats.matches[0]?.id ?? null,
    escalation_level: 0,
    reopen_count: 0,
    cancel_reason: null,
    created_by: user.id,
    observed_at: body.observed_at ?? nowIso(),
    assigned_at: supervisorId ? nowIso() : null,
    acknowledged_at: null,
    compliance_submitted_at: null,
    verified_at: null,
    closed_at: null,
    closed_by: null,
    client_uuid: body.client_uuid ?? uuid(),
    created_at: nowIso(),
    updated_at: null,
  });

  timeline(created.id, {
    action: 'SUBMITTED', to: 'submitted', actor: user,
    remarks: `Observation recorded during ${inspection.ref_no}`,
    metadata: { repeat_count: repeats.count },
  });
  if (supervisorId) {
    const sup = byId('supervisors', supervisorId);
    timeline(created.id, {
      action: 'ASSIGNED', from: 'submitted', to: 'assigned', actor: user,
      remarks: `Assigned to ${sup?.name}${sup?.designation ? `, ${sup.designation}` : ''} (${department.name})`,
      metadata: { assignment_mode: assignmentMode, supervisor_id: supervisorId },
    });
  }
  const view = viewObservation(created);
  audit({
    action: 'OBSERVATION_CREATE', entityType: 'observation', entityId: created.id, user, next: view,
    remarks: repeats.count ? `Repeated deficiency (${repeats.count} previous occurrence(s))` : null,
  });
  const notification = dispatch({
    event: supervisorId ? 'OBSERVATION_ASSIGNED' : 'OBSERVATION_UNASSIGNED',
    observation: view, actorId: user.id, extraVars: { repeat_count: repeats.count },
  });
  let escalated = { recipients: 0 };
  if (severity?.notify_immediately || severity?.escalate_immediately) {
    escalated = dispatch({ event: 'CRITICAL_OBSERVATION', observation: view, actorId: user.id });
  }

  return {
    ...view,
    repeats,
    notification: { ...notification, escalated_recipients: escalated.recipients },
    tdc_rule: body.tdc
      ? table('tdc_rules').find((r) => r.severity_id === severityId) ?? table('tdc_rules')[0]
      : null,
    suggested_tdc: null,
  };
});

on('GET', '/observations/:id', ({ params, user }) => {
  require_(user, 'observation:read');
  const observation = observationById(params[0]!);
  if (!observation) throw notFound('Observation');
  const supervisorRecord = table('supervisors').find((s) => s.user_id === user.id);
  const canActAsSupervisor =
    isAdmin(user) ||
    (supervisorRecord && observation.supervisor_id === supervisorRecord.id) ||
    (user.role === 'supervisor' && user.department_id === observation.action_by_department_id);
  const canEdit =
    isAdmin(user) ||
    (observation.created_by === user.id &&
      ['submitted', 'assigned'].includes(observation.status) &&
      !observation.acknowledged_at);

  return {
    ...observation,
    timeline: where('observation_events', (e) => e.observation_id === observation.id)
      .sort((a, b) => a.id - b.id)
      .map((e) => ({ ...e, metadata: e.metadata ? JSON.parse(e.metadata) : null })),
    attachments: where('attachments', (a) => a.observation_id === observation.id),
    compliances: where('compliances', (c) => c.observation_id === observation.id)
      .sort((a, b) => a.round - b.round)
      .map((c) => ({
        ...c,
        submitted_by_name: byId('users', c.submitted_by)?.name ?? '',
        submitted_by_designation: byId('users', c.submitted_by)?.designation ?? null,
        verified_by_name: byId('users', c.verified_by)?.name ?? null,
        attachments: where('attachments', (a) => a.compliance_id === c.id),
      })),
    repeats: findRepeats({
      stationId: observation.station_id,
      trainId: observation.train_id,
      unitId: observation.unit_id,
      unitName: observation.unit_name,
      itemId: observation.item_id,
      itemName: observation.item_name,
      categoryId: observation.category_id,
      observation: observation.observation,
      excludeObservationId: observation.id,
      windowDays: 365,
    }),
    approvals: where('approvals', (a) => a.entity_type === 'observation' && a.entity_id === observation.id),
    rule_reference: byId('rule_references', observation.rule_reference_id) ?? null,
    supervisor: observation.supervisor_id
      ? {
          ...byId('supervisors', observation.supervisor_id),
          department_name: byId('departments', byId('supervisors', observation.supervisor_id)?.department_id)?.name,
          reporting_officer_name: byId('supervisors', byId('supervisors', observation.supervisor_id)?.reporting_officer_id)?.name ?? null,
        }
      : null,
    notifications: where('notifications', (n) => n.observation_id === observation.id)
      .sort((a, b) => b.id - a.id)
      .slice(0, 50)
      .map((n) => ({
        id: n.id,
        event: n.event,
        title: n.title,
        created_at: n.created_at,
        recipient: byId('users', n.user_id)?.name ?? '',
        channels: where('notification_deliveries', (d) => d.notification_id === n.id)
          .map((d) => `${d.channel}:${d.status}`)
          .join(', '),
      })),
    permissions: {
      can_acknowledge: isOpenStatus(observation.status) && observation.status !== 'acknowledged' && Boolean(canActAsSupervisor),
      can_submit_compliance: isOpenStatus(observation.status) && Boolean(canActAsSupervisor),
      can_verify:
        observation.status === 'compliance_submitted' &&
        (isAdmin(user) || isOfficer(user) || observation.created_by === user.id),
      can_reassign: isAdmin(user) || isOfficer(user) || observation.created_by === user.id,
      can_edit: canEdit,
      can_cancel: isAdmin(user) || isOfficer(user),
    },
  };
});

on('GET', '/observations/:id/repeats', ({ params, q }) => {
  const observation = observationById(params[0]!);
  if (!observation) throw notFound('Observation');
  return findRepeats({
    stationId: observation.station_id,
    trainId: observation.train_id,
    unitId: observation.unit_id,
    unitName: observation.unit_name,
    itemId: observation.item_id,
    itemName: observation.item_name,
    categoryId: observation.category_id,
    observation: observation.observation,
    excludeObservationId: observation.id,
    windowDays: num(q.get('window_days')) ?? 365,
  });
});

on('GET', '/observations/:id/photo-comparison', ({ params }) => {
  const observation = observationById(params[0]!);
  if (!observation) throw notFound('Observation');
  const repeats = findRepeats({
    stationId: observation.station_id,
    trainId: observation.train_id,
    unitId: observation.unit_id,
    unitName: observation.unit_name,
    itemId: observation.item_id,
    itemName: observation.item_name,
    categoryId: observation.category_id,
    observation: observation.observation,
    excludeObservationId: observation.id,
    windowDays: 730,
    limit: 5,
  });
  const photos = (id: number, phase: string) =>
    where('attachments', (a) => a.observation_id === id && a.kind === 'photo' && a.phase === phase);
  return {
    current: {
      observation: {
        id: observation.id, ref_no: observation.ref_no, observed_at: observation.observed_at,
        observation: observation.observation, status: observation.status,
      },
      observation_photos: photos(observation.id, 'observation'),
      compliance_photos: photos(observation.id, 'compliance'),
    },
    previous: repeats.matches.map((m) => ({
      observation: {
        id: m.id, ref_no: m.ref_no, observed_at: m.observed_at, observation: m.observation,
        status: m.status, match_reason: m.match_reason, similarity: m.similarity,
      },
      observation_photos: photos(m.id, 'observation'),
      compliance_photos: photos(m.id, 'compliance'),
    })),
  };
});

/* ------------------------- observation mutations -------------------------- */

const assertSupervisorOf = (observation: Row, user: Row) => {
  if (isAdmin(user)) return;
  const sup = table('supervisors').find((s) => s.user_id === user.id && s.active);
  if (sup && observation.supervisor_id === sup.id) return;
  if (user.department_id && user.department_id === observation.action_by_department_id) return;
  throw forbidden('This observation is not assigned to you');
};

on('PATCH', '/observations/:id', ({ params, body, user }) => {
  require_(user, 'observation:update');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  const before = viewObservation(row);
  if (!isAdmin(user) && !isOfficer(user) && row.created_by !== user.id) {
    throw forbidden('Only the raising officer, a divisional officer or an admin can change this');
  }
  const { remarks, ...changes } = body ?? {};
  if (!Object.keys(changes).length) throw bad('Nothing to update');
  update('observations', row.id, { ...changes, updated_at: nowIso() });
  const after = viewObservation(row);
  timeline(row.id, {
    action: 'UPDATED', from: before.status, to: after.status, actor: user,
    remarks: remarks ?? Object.keys(changes).map((f) => `${f}: "${before[f] ?? '-'}" -> "${after[f] ?? '-'}"`).join('; '),
    metadata: { fields: Object.keys(changes) },
  });
  audit({ action: 'OBSERVATION_UPDATE', entityType: 'observation', entityId: row.id, user, previous: before, next: after, remarks });
  if ('tdc' in changes && (changes.tdc ?? null) !== (before.tdc ?? null)) {
    dispatch({
      event: 'TDC_CHANGED', observation: after, actorId: user.id,
      extraVars: { old_tdc: before.tdc ?? 'not specified', new_tdc: after.tdc ?? 'removed' },
    });
  }
  return after;
});

on('POST', '/observations/:id/acknowledge', ({ params, body, user }) => {
  require_(user, 'observation:acknowledge');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  assertSupervisorOf(row, user);
  if (!isOpenStatus(row.status)) throw bad(`An observation with status "${row.status}" cannot be acknowledged`);
  const from = row.status;
  update('observations', row.id, {
    status: 'acknowledged',
    acknowledged_at: row.acknowledged_at ?? nowIso(),
    updated_at: nowIso(),
  });
  timeline(row.id, { action: 'ACKNOWLEDGED', from, to: 'acknowledged', actor: user, remarks: body?.remarks ?? null });
  audit({ action: 'OBSERVATION_ACKNOWLEDGE', entityType: 'observation', entityId: row.id, user, previous: { status: from }, next: { status: 'acknowledged' } });
  const view = viewObservation(row);
  dispatch({ event: 'OBSERVATION_ACKNOWLEDGED', observation: view, actorId: user.id });
  return view;
});

on('POST', '/observations/:id/progress', ({ params, body, user }) => {
  require_(user, 'compliance:submit');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  assertSupervisorOf(row, user);
  if (!isOpenStatus(row.status)) throw bad(`An observation with status "${row.status}" cannot be progressed`);
  if (!body?.remarks || String(body.remarks).trim().length < 3) throw bad('Describe the progress');
  const from = row.status;
  update('observations', row.id, {
    status: 'in_progress',
    acknowledged_at: row.acknowledged_at ?? nowIso(),
    updated_at: nowIso(),
  });
  timeline(row.id, { action: 'ACTION_IN_PROGRESS', from, to: 'in_progress', actor: user, remarks: body.remarks });
  audit({ action: 'OBSERVATION_PROGRESS', entityType: 'observation', entityId: row.id, user, previous: { status: from }, next: { status: 'in_progress' }, remarks: body.remarks });
  return viewObservation(row);
});

on('POST', '/observations/:id/compliance', ({ params, body, user }) => {
  require_(user, 'compliance:submit');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  assertSupervisorOf(row, user);
  if (!isOpenStatus(row.status)) throw bad(`Compliance cannot be submitted while the status is "${row.status}"`);
  const actionTaken = String(body?.action_taken ?? '').trim();
  if (actionTaken.length < 5) {
    throw bad('Validation failed', [{ path: 'action_taken', message: 'Describe the action taken' }]);
  }
  const round = where('compliances', (c) => c.observation_id === row.id).reduce((max, c) => Math.max(max, c.round), 0) + 1;
  const compliance = insert('compliances', {
    observation_id: row.id,
    round,
    supervisor_id: row.supervisor_id ?? null,
    submitted_by: user.id,
    action_taken: actionTaken,
    remarks: body?.remarks ?? null,
    compliance_date: body?.compliance_date ?? todayIso(),
    expenditure: null,
    status: 'submitted',
    verified_by: null,
    verified_at: null,
    verification_remarks: null,
    rejection_reason: null,
    submitted_at: nowIso(),
  });
  for (const file of body?.__files ?? []) {
    insert('attachments', {
      observation_id: row.id,
      inspection_id: null,
      compliance_id: compliance.id,
      kind: 'photo',
      phase: 'compliance',
      file_name: file.name ?? 'compliance.png',
      stored_name: file.stored_name ?? `demo-compliance-${uuid().slice(0, 8)}.png`,
      mime_type: 'image/png',
      size_bytes: file.size ?? null,
      caption: 'Compliance evidence',
      uploaded_by: user.id,
      created_at: nowIso(),
    });
  }
  const from = row.status;
  update('observations', row.id, {
    status: 'compliance_submitted',
    compliance_submitted_at: nowIso(),
    acknowledged_at: row.acknowledged_at ?? nowIso(),
    updated_at: nowIso(),
  });
  timeline(row.id, {
    action: 'COMPLIANCE_SUBMITTED', from, to: 'compliance_submitted', actor: user,
    remarks: actionTaken, metadata: { round },
  });
  audit({ action: 'COMPLIANCE_SUBMIT', entityType: 'observation', entityId: row.id, user, previous: { status: from }, next: { status: 'compliance_submitted', round } });
  const view = viewObservation(row);
  dispatch({ event: 'COMPLIANCE_SUBMITTED', observation: view, actorId: user.id, extraVars: { action_taken: actionTaken, round } });
  return { ...view, compliance };
});

on('POST', '/observations/:id/verify', ({ params, body, user }) => {
  require_(user, 'observation:verify');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  if (!isAdmin(user) && !isOfficer(user) && row.created_by !== user.id) {
    throw forbidden('Only the inspecting officer who raised this observation can verify it');
  }
  if (row.status !== 'compliance_submitted') throw bad('Only an observation with submitted compliance can be verified');
  const compliance = where('compliances', (c) => c.observation_id === row.id).sort((a, b) => b.round - a.round)[0];
  if (!compliance) throw bad('No compliance has been submitted for this observation');
  const decision = body?.decision;
  if (decision === 'reject' && !body?.rejection_reason) throw bad('A reason is mandatory when rejecting compliance');

  if (decision === 'accept') {
    update('compliances', compliance.id, {
      status: 'accepted', verified_by: user.id, verified_at: nowIso(),
      verification_remarks: body?.remarks ?? null,
    });
    update('observations', row.id, {
      status: 'closed', verified_at: nowIso(), closed_at: nowIso(), closed_by: user.id,
      requires_physical_verification: 0, updated_at: nowIso(),
    });
    timeline(row.id, { action: 'VERIFIED', from: 'compliance_submitted', to: 'verified', actor: user, remarks: body?.remarks ?? 'Compliance accepted' });
    timeline(row.id, { action: 'CLOSED', from: 'verified', to: 'closed', actor: user, remarks: 'Observation closed after verification of compliance' });
    insert('approvals', {
      entity_type: 'observation', entity_id: row.id, approval_role: 'inspector',
      user_id: user.id, user_name: user.name, designation: user.designation ?? null,
      remarks: body?.remarks ?? null, signature_data: body?.signature_data ?? null, signed_at: nowIso(),
    });
    audit({ action: 'COMPLIANCE_VERIFY', entityType: 'observation', entityId: row.id, user, next: { status: 'closed', decision } });
    const view = viewObservation(row);
    dispatch({ event: 'OBSERVATION_CLOSED', observation: view, actorId: user.id });
    return view;
  }

  if (decision === 'reject') {
    update('compliances', compliance.id, {
      status: 'rejected', verified_by: user.id, verified_at: nowIso(),
      rejection_reason: body.rejection_reason, verification_remarks: body?.remarks ?? null,
    });
    update('observations', row.id, {
      status: 'reopened', reopen_count: (row.reopen_count ?? 0) + 1,
      compliance_submitted_at: null, updated_at: nowIso(),
    });
    timeline(row.id, { action: 'COMPLIANCE_REJECTED', from: 'compliance_submitted', to: 'reopened', actor: user, remarks: body.rejection_reason });
    audit({ action: 'COMPLIANCE_VERIFY', entityType: 'observation', entityId: row.id, user, next: { status: 'reopened', decision }, remarks: body.rejection_reason });
    const view = viewObservation(row);
    dispatch({ event: 'COMPLIANCE_REJECTED', observation: view, actorId: user.id, extraVars: { rejection_reason: body.rejection_reason } });
    return view;
  }

  update('compliances', compliance.id, {
    status: 'physical_verification_required', verified_by: user.id, verified_at: nowIso(),
    verification_remarks: body?.remarks ?? null,
  });
  update('observations', row.id, {
    status: 'in_progress', requires_physical_verification: 1,
    compliance_submitted_at: null, updated_at: nowIso(),
  });
  timeline(row.id, {
    action: 'PHYSICAL_VERIFICATION_REQUIRED', from: 'compliance_submitted', to: 'in_progress',
    actor: user, remarks: body?.remarks ?? 'Physical verification required before closure',
  });
  audit({ action: 'COMPLIANCE_VERIFY', entityType: 'observation', entityId: row.id, user, next: { status: 'in_progress', decision } });
  const view = viewObservation(row);
  dispatch({ event: 'PHYSICAL_VERIFICATION_REQUIRED', observation: view, actorId: user.id });
  return view;
});

on('POST', '/observations/:id/reassign', ({ params, body, user }) => {
  require_(user, 'observation:update');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  if (!isAdmin(user) && !isOfficer(user) && row.created_by !== user.id) {
    throw forbidden('Only the raising officer, a divisional officer or an admin can reassign');
  }
  if (['closed', 'cancelled'].includes(row.status)) throw bad('A closed observation cannot be reassigned. Reopen it first.');
  if (!body?.reason || String(body.reason).trim().length < 3) throw bad('Give the reason for reassignment');
  const before = viewObservation(row);
  const departmentId = body.action_by_department_id ?? row.action_by_department_id;
  let supervisorId = body.supervisor_id ?? null;
  if (!supervisorId) {
    supervisorId = autoAssign({
      stationId: row.station_id, unitId: row.unit_id, departmentId, itemId: row.item_id,
    })?.id ?? null;
  }
  update('observations', row.id, {
    action_by_department_id: departmentId,
    supervisor_id: supervisorId,
    assignment_mode: body.supervisor_id ? 'manual' : supervisorId ? 'auto' : 'unassigned',
    status: supervisorId ? 'assigned' : 'submitted',
    assigned_at: supervisorId ? nowIso() : null,
    acknowledged_at: null,
    escalation_level: 0,
    ...(body.tdc !== undefined ? { tdc: body.tdc } : {}),
    updated_at: nowIso(),
  });
  const after = viewObservation(row);
  timeline(row.id, {
    action: 'REASSIGNED', from: before.status, to: after.status, actor: user,
    remarks: `${before.department_name} -> ${after.department_name}${after.supervisor_name ? ` / ${after.supervisor_name}` : ''}. Reason: ${body.reason}`,
  });
  audit({
    action: 'OBSERVATION_REASSIGN', entityType: 'observation', entityId: row.id, user,
    previous: { department: before.department_name, supervisor: before.supervisor_name },
    next: { department: after.department_name, supervisor: after.supervisor_name },
    remarks: body.reason,
  });
  dispatch({ event: 'OBSERVATION_ASSIGNED', observation: after, actorId: user.id, extraVars: { reassigned: 'yes' } });
  return after;
});

on('POST', '/observations/:id/cancel', ({ params, body, user }) => {
  if (!isAdmin(user) && !isOfficer(user)) throw forbidden('Only a divisional officer or an admin can cancel an observation');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  if (row.status === 'closed') throw bad('A closed observation cannot be cancelled');
  if (!body?.reason || String(body.reason).trim().length < 5) throw bad('Give the reason for cancellation');
  const from = row.status;
  update('observations', row.id, { status: 'cancelled', cancel_reason: body.reason, updated_at: nowIso() });
  timeline(row.id, { action: 'CANCELLED', from, to: 'cancelled', actor: user, remarks: body.reason });
  audit({ action: 'OBSERVATION_CANCEL', entityType: 'observation', entityId: row.id, user, previous: { status: from }, next: { status: 'cancelled' }, remarks: body.reason });
  return viewObservation(row);
});

on('POST', '/observations/:id/reopen', ({ params, body, user }) => {
  require_(user, 'observation:update');
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  if (!isAdmin(user) && !isOfficer(user) && row.created_by !== user.id) {
    throw forbidden('Only the raising officer, a divisional officer or an admin can reopen');
  }
  if (row.status !== 'closed') throw bad('Only a closed observation can be reopened');
  if (!body?.reason || String(body.reason).trim().length < 5) throw bad('Give the reason for reopening');
  update('observations', row.id, {
    status: 'reopened', reopen_count: (row.reopen_count ?? 0) + 1,
    closed_at: null, closed_by: null, verified_at: null, updated_at: nowIso(),
  });
  timeline(row.id, { action: 'REOPENED', from: 'closed', to: 'reopened', actor: user, remarks: body.reason });
  audit({ action: 'OBSERVATION_REOPEN', entityType: 'observation', entityId: row.id, user, previous: { status: 'closed' }, next: { status: 'reopened' }, remarks: body.reason });
  const view = viewObservation(row);
  dispatch({ event: 'OBSERVATION_REOPENED', observation: view, actorId: user.id, extraVars: { reason: body.reason } });
  return view;
});

on('POST', '/observations/:id/attachments', ({ params, body, user }) => {
  const row = byId('observations', params[0]);
  if (!row) throw notFound('Observation');
  const files = body?.__files ?? [];
  if (!files.length) throw bad('No file was uploaded');
  const created = files.map((file: Row) =>
    insert('attachments', {
      observation_id: row.id,
      inspection_id: null,
      compliance_id: null,
      kind: 'photo',
      phase: body?.phase ?? 'observation',
      file_name: file.name ?? 'photo.png',
      stored_name: file.stored_name ?? `demo-observation-${uuid().slice(0, 8)}.png`,
      mime_type: 'image/png',
      size_bytes: file.size ?? null,
      caption: body?.caption ?? null,
      uploaded_by: user.id,
      created_at: nowIso(),
    })
  );
  audit({ action: 'ATTACHMENT_ADD', entityType: 'observation', entityId: row.id, user, next: { count: created.length } });
  return { data: created };
});

on('DELETE', '/observations/:id/attachments/:attachmentId', ({ params, user }) => {
  const list = table('attachments');
  const index = list.findIndex((a) => a.id === Number(params[1]) && a.observation_id === Number(params[0]));
  if (index < 0) throw notFound('Attachment');
  const [removed] = list.splice(index, 1);
  audit({ action: 'ATTACHMENT_DELETE', entityType: 'observation', entityId: params[0], user, previous: removed });
  return { ok: true };
});

/* ------------------------------ compliance -------------------------------- */

on('GET', '/compliance/queue', ({ q, user }) => {
  const base = new URLSearchParams(q);
  base.set('assigned_to_me', '1');
  if (!q.get('status')) base.set('open', '1');
  if (!base.get('sort')) base.set('sort', 'tdc');
  const result = page(filterObservations(base, user), base, 25);
  const bucket = (extra: string) => {
    const params = new URLSearchParams(`assigned_to_me=1&${extra}`);
    return filterObservations(params, user).length;
  };
  return {
    ...result,
    buckets: {
      to_acknowledge: bucket('status=assigned,submitted'),
      in_progress: bucket('status=acknowledged,in_progress'),
      rejected: bucket('status=rejected,reopened'),
      overdue: bucket('overdue=1'),
      submitted: bucket('status=compliance_submitted'),
    },
  };
});

on('GET', '/compliance/awaiting-verification', ({ q, user }) => {
  const base = new URLSearchParams(q);
  base.set('awaiting_verification', '1');
  base.set('sort', 'oldest');
  return page(filterObservations(base, user), base, 25);
});

on('GET', '/compliance', ({ q, user }) => {
  const observationId = num(q.get('observation_id'));
  const status = q.get('status')?.split(',').map((s) => s.trim());
  const rows = table('compliances')
    .filter((c) => {
      if (observationId !== undefined && c.observation_id !== observationId) return false;
      if (status?.length && !status.includes(c.status)) return false;
      const observation = byId('observations', c.observation_id);
      return observation ? inScope(viewObservation(observation), user) : false;
    })
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
    .map((c) => {
      const observation = viewObservation(byId('observations', c.observation_id)!);
      return {
        ...c,
        observation_ref: observation.ref_no,
        observation: observation.observation,
        observation_status: observation.status,
        station_name: observation.station_name,
        unit_name: observation.unit_name,
        item_name: observation.item_name,
        module_code: observation.module_code,
        severity_name: observation.severity_name,
        tdc: observation.tdc,
        department_name: observation.department_name,
        submitted_by_name: byId('users', c.submitted_by)?.name ?? '',
        verified_by_name: byId('users', c.verified_by)?.name ?? null,
        attachment_count: where('attachments', (a) => a.compliance_id === c.id).length,
      };
    });
  return page(rows, q, 25);
});

/* ------------------------------ dashboards -------------------------------- */

const metrics = (rows: Row[]) => ({
  total: rows.length,
  open: rows.filter((o) => o.is_open).length,
  overdue: rows.filter((o) => o.is_overdue).length,
  compliance_submitted: rows.filter((o) => o.status === 'compliance_submitted').length,
  closed: rows.filter((o) => o.status === 'closed').length,
  reopened: rows.filter((o) => o.status === 'reopened').length,
  acknowledged: rows.filter((o) => o.status === 'acknowledged').length,
  in_progress: rows.filter((o) => o.status === 'in_progress').length,
  submitted: rows.filter((o) => o.status === 'submitted').length,
  assigned: rows.filter((o) => o.status === 'assigned').length,
  cancelled: rows.filter((o) => o.status === 'cancelled').length,
  critical: rows.filter((o) => o.severity_rank === 1).length,
  critical_open: rows.filter((o) => o.severity_rank === 1 && o.is_open).length,
  repeated: rows.filter((o) => o.repeat_count > 0).length,
  with_tdc: rows.filter((o) => o.tdc).length,
  due_soon: rows.filter((o) => o.is_open && o.days_to_tdc !== null && o.days_to_tdc >= 0 && o.days_to_tdc <= 3).length,
});

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

const closureDays = (o: Row) =>
  o.closed_at ? (Date.parse(o.closed_at) - Date.parse(o.observed_at)) / 86_400_000 : null;

on('GET', '/dashboard/overview', ({ q, user }) => {
  const rows = filterObservations(q, user);
  const closed = rows.filter((o) => o.closed_at);
  const durations = closed.map(closureDays).filter((d): d is number => d !== null);
  const inspectionRows = inspections().filter((i) => {
    const moduleId = num(q.get('module_id'));
    if (moduleId !== undefined && i.module_id !== moduleId) return false;
    const stationId = num(q.get('station_id'));
    if (stationId !== undefined && i.station_id !== stationId) return false;
    if (bool(q.get('mine')) === true && i.inspector_id !== user.id) return false;
    return true;
  });
  const today = todayIso();
  const closedRows = rows.filter((o) => o.status === 'closed');
  return {
    observations: metrics(rows),
    inspections: {
      total: inspectionRows.length,
      today: inspectionRows.filter((i) => dateOnly(i.created_at) === today).length,
      in_progress: inspectionRows.filter((i) => i.status === 'in_progress').length,
      completed: inspectionRows.filter((i) => i.status === 'completed').length,
      this_week: inspectionRows.filter((i) => Date.parse(i.created_at) > Date.now() - 7 * 86_400_000).length,
    },
    compliance: {
      avg_closure_days: durations.length ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      fastest_closure_days: durations.length ? round1(Math.min(...durations)) : null,
      slowest_closure_days: durations.length ? round1(Math.max(...durations)) : null,
      closed_on_time: closedRows.filter((o) => o.tdc && dateOnly(o.closed_at)! <= o.tdc).length,
      closed_late: closedRows.filter((o) => o.tdc && dateOnly(o.closed_at)! > o.tdc).length,
      closure_rate: rows.length ? Math.round((closedRows.length / rows.length) * 1000) / 10 : 0,
    },
  };
});

on('GET', '/dashboard/modules', ({ q, user }) => ({
  data: activeRows('modules').map((module) => {
    const params = new URLSearchParams(q);
    params.set('module_id', String(module.id));
    const rows = filterObservations(params, user);
    return {
      module,
      inspections: inspections().filter((i) => i.module_id === module.id).length,
      ...metrics(rows),
    };
  }),
}));

const groupBy = (rows: Row[], key: (row: Row) => string | number | null) => {
  const map = new Map<string | number, Row[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null || k === undefined) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  return map;
};

on('GET', '/dashboard/departments', ({ q, user }) => {
  const rows = filterObservations(q, user);
  const data = [...groupBy(rows, (o) => o.action_by_department_id).entries()]
    .map(([departmentId, group]) => {
      const durations = group.map(closureDays).filter((d): d is number => d !== null);
      return {
        department_id: Number(departmentId),
        department_name: group[0]!.department_name,
        department_code: group[0]!.department_code,
        total: group.length,
        pending: group.filter((o) => o.is_open).length,
        due_soon: group.filter((o) => o.is_open && o.days_to_tdc !== null && o.days_to_tdc >= 0 && o.days_to_tdc <= 3).length,
        overdue: group.filter((o) => o.is_overdue).length,
        compliance_submitted: group.filter((o) => o.status === 'compliance_submitted').length,
        closed: group.filter((o) => o.status === 'closed').length,
        critical: group.filter((o) => o.severity_rank === 1).length,
        avg_closure_days: durations.length ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      };
    })
    .sort((a, b) => b.total - a.total);
  return { data };
});

on('GET', '/dashboard/stations', ({ q, user }) => {
  const rows = filterObservations(q, user).filter((o) => o.station_id);
  const limit = num(q.get('limit')) ?? 50;
  const data = [...groupBy(rows, (o) => o.station_id).entries()]
    .map(([stationId, group]) => ({
      station_id: Number(stationId),
      station_name: group[0]!.station_name,
      station_code: group[0]!.station_code,
      division_name: group[0]!.division_name,
      observations: group.length,
      pending: group.filter((o) => o.is_open).length,
      overdue: group.filter((o) => o.is_overdue).length,
      closed: group.filter((o) => o.status === 'closed').length,
      repeated: group.filter((o) => o.repeat_count > 0).length,
      critical: group.filter((o) => o.severity_rank === 1).length,
      passenger_amenities: group.filter((o) => o.module_code === 'PA').length,
      commercial: group.filter((o) => o.module_code === 'CI').length,
      safe_running: group.filter((o) => o.module_code === 'SR').length,
      inspections: where('inspections', (i) => i.station_id === Number(stationId)).length,
      last_observation_at: group.map((o) => o.observed_at).sort().pop() ?? null,
    }))
    .sort((a, b) => b.pending - a.pending || b.observations - a.observations)
    .slice(0, limit);
  return { data };
});

on('GET', '/dashboard/severity', ({ q, user }) => {
  const rows = filterObservations(q, user);
  const data = [...groupBy(rows, (o) => o.severity_id).entries()]
    .map(([severityId, group]) => ({
      severity_id: Number(severityId),
      severity_name: group[0]!.severity_name,
      severity_rank: group[0]!.severity_rank,
      severity_accent: group[0]!.severity_accent,
      total: group.length,
      open: group.filter((o) => o.is_open).length,
      overdue: group.filter((o) => o.is_overdue).length,
      closed: group.filter((o) => o.status === 'closed').length,
    }))
    .sort((a, b) => a.severity_rank - b.severity_rank);
  return { data };
});

on('GET', '/dashboard/categories', ({ q, user }) => {
  const rows = filterObservations(q, user);
  const data = [...groupBy(rows, (o) => o.category_name ?? 'Uncategorised').entries()]
    .map(([name, group]) => ({
      category_name: String(name),
      category_id: group[0]!.category_id,
      total: group.length,
      open: group.filter((o) => o.is_open).length,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
  return { data };
});

on('GET', '/dashboard/trends', ({ q, user }) => {
  const days = num(q.get('days')) ?? 30;
  const rows = filterObservations(q, user);
  const byDay = new Map<string, { day: string; raised: number; closed: number }>();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { day: key, raised: 0, closed: 0 });
  }
  for (const o of rows) {
    const raised = dateOnly(o.observed_at)!;
    if (byDay.has(raised)) byDay.get(raised)!.raised += 1;
    const closed = dateOnly(o.closed_at);
    if (closed && byDay.has(closed)) byDay.get(closed)!.closed += 1;
  }
  return { days, data: [...byDay.values()] };
});

on('GET', '/dashboard/repeats', ({ q, user }) => {
  const windowDays = num(q.get('days')) ?? 90;
  const params = new URLSearchParams(q);
  params.set('days', String(windowDays));
  const rows = filterObservations(params, user).filter((o) => o.item_name);
  const limit = num(q.get('limit')) ?? 15;
  const data = [...groupBy(rows, (o) => `${o.station_id}|${o.unit_name}|${o.item_name}`).entries()]
    .filter(([, group]) => group.length > 1)
    .map(([, group]) => ({
      station_id: group[0]!.station_id,
      station_name: group[0]!.station_name,
      station_code: group[0]!.station_code,
      unit_name: group[0]!.unit_name,
      item_name: group[0]!.item_name,
      module_code: group[0]!.module_code,
      module_name: group[0]!.module_name,
      occurrences: group.length,
      open: group.filter((o) => o.is_open).length,
      last_seen: group.map((o) => o.observed_at).sort().pop(),
      first_seen: group.map((o) => o.observed_at).sort()[0],
      refs: group.map((o) => o.ref_no),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || String(b.last_seen).localeCompare(String(a.last_seen)))
    .slice(0, limit);
  return { window_days: windowDays, data };
});

on('GET', '/dashboard/supervisors', ({ q, user }) => {
  const rows = filterObservations(q, user).filter((o) => o.supervisor_id);
  const data = [...groupBy(rows, (o) => o.supervisor_id).entries()]
    .map(([supervisorId, group]) => {
      const responses = group
        .filter((o) => o.compliance_submitted_at)
        .map((o) => (Date.parse(o.compliance_submitted_at) - Date.parse(o.observed_at)) / 86_400_000);
      return {
        supervisor_id: Number(supervisorId),
        supervisor_name: group[0]!.supervisor_name,
        supervisor_designation: group[0]!.supervisor_designation,
        department_name: group[0]!.department_name,
        assigned: group.length,
        pending: group.filter((o) => o.is_open).length,
        overdue: group.filter((o) => o.is_overdue).length,
        closed: group.filter((o) => o.status === 'closed').length,
        avg_response_days: responses.length ? round1(responses.reduce((a, b) => a + b, 0) / responses.length) : null,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.pending - a.pending)
    .slice(0, 40);
  return { data };
});

on('GET', '/dashboard/home', ({ user }) => {
  const all = filterObservations(new URLSearchParams(), user);
  const mine = filterObservations(new URLSearchParams('mine=1'), user);
  const assigned = filterObservations(new URLSearchParams('assigned_to_me=1'), user);
  const supervisorId = table('supervisors').find((s) => s.user_id === user.id)?.id ?? null;
  return {
    modules: activeRows('modules').map((module) => ({
      ...module,
      ...metrics(all.filter((o) => o.module_id === module.id)),
    })),
    tiles: {
      my_inspections: where('inspections', (i) => i.inspector_id === user.id).length,
      my_observations: mine.length,
      pending_observations: all.filter((o) => o.is_open).length,
      compliance_pending: assigned.filter((o) => o.is_open).length,
      awaiting_verification: all.filter((o) => o.status === 'compliance_submitted').length,
      overdue: all.filter((o) => o.is_overdue).length,
      critical_open: all.filter((o) => o.severity_rank === 1 && o.is_open).length,
      closed: all.filter((o) => o.status === 'closed').length,
    },
    recent_observations: observations()
      .filter((o) => o.created_by === user.id || (supervisorId && o.supervisor_id === supervisorId))
      .sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)))
      .slice(0, 8)
      .map((o) => ({
        id: o.id, ref_no: o.ref_no, observation: o.observation, status: o.status,
        severity_name: o.severity_name, module_code: o.module_code, station_name: o.station_name,
        unit_name: o.unit_name, item_name: o.item_name, tdc: o.tdc,
        is_overdue: o.is_overdue ? 1 : 0, observed_at: o.observed_at,
      })),
  };
});

/* -------------------------------- history --------------------------------- */

const countBy = (rows: Row[], key: (row: Row) => string) => {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row) ?? 'Not specified';
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};

on('GET', '/history/stations/:id', ({ params, q }) => {
  const station = byId('stations', params[0]);
  if (!station) throw notFound('Station');
  const days = num(q.get('days')) ?? 365;
  const cutoff = Date.now() - days * 86_400_000;
  const stationInspections = inspections()
    .filter((i) => i.station_id === station.id && Date.parse(i.created_at) >= cutoff)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rows = observations()
    .filter((o) => o.station_id === station.id && Date.parse(o.observed_at) >= cutoff)
    .sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)));
  const durations = rows.map(closureDays).filter((d): d is number => d !== null);

  const repeated = [...groupBy(rows.filter((o) => o.item_name), (o) => `${o.unit_name}|${o.item_name}`).entries()]
    .filter(([, group]) => group.length > 1)
    .map(([, group]) => ({
      unit_name: group[0]!.unit_name,
      item_name: group[0]!.item_name,
      module_code: group[0]!.module_code,
      occurrences: group.length,
      last_seen: group.map((o) => o.observed_at).sort().pop(),
      first_seen: group.map((o) => o.observed_at).sort()[0],
      open: group.filter((o) => o.is_open).length,
      refs: group.map((o) => o.ref_no),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    station: stationView(station),
    window_days: days,
    summary: {
      inspections: stationInspections.length,
      observations: rows.length,
      pending: rows.filter((o) => o.is_open).length,
      overdue: rows.filter((o) => o.is_overdue).length,
      closed: rows.filter((o) => o.status === 'closed').length,
      repeated: rows.filter((o) => o.repeat_count > 0).length,
      critical: rows.filter((o) => o.severity_rank === 1).length,
      by_module: countBy(rows, (o) => o.module_name),
      by_department: countBy(rows, (o) => o.department_name),
      by_unit: countBy(rows, (o) => o.unit_name ?? 'Not specified'),
      avg_closure_days: durations.length ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    },
    repeated_deficiencies: repeated,
    inspections: stationInspections,
    observations: rows,
    units: unitsFor(station.id, 'station'),
  };
});

on('GET', '/history/stations/:id/compare', ({ params, q }) => {
  const stationId = Number(params[0]);
  const list = inspections()
    .filter((i) => i.station_id === stationId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20);
  if (!list.length) throw notFound('Inspection for this station');
  const currentId = num(q.get('current'));
  const current = (currentId ? list.find((i) => i.id === currentId) : undefined) ?? list[0]!;
  const previousId = num(q.get('previous'));
  const previous = previousId ? list.find((i) => i.id === previousId) : list.find((i) => i.id !== current.id);

  const obsFor = (id?: number) =>
    id ? observations().filter((o) => o.inspection_id === id) : [];
  const currentObs = obsFor(current.id);
  const previousObs = obsFor(previous?.id);
  const key = (o: Row) => `${String(o.unit_name ?? '').toLowerCase()}|${String(o.item_name ?? '').toLowerCase()}`;
  const previousKeys = new Map(previousObs.map((o) => [key(o), o]));
  const currentKeys = new Map(currentObs.map((o) => [key(o), o]));

  return {
    available_inspections: list,
    current,
    previous: previous ?? null,
    carried_forward: currentObs
      .filter((o) => previousKeys.has(key(o)))
      .map((o) => ({ current: o, previous: previousKeys.get(key(o))! })),
    newly_observed: currentObs.filter((o) => !previousKeys.has(key(o))),
    rectified_since_last: previousObs.filter((o) => o.status === 'closed' && !currentKeys.has(key(o))),
    still_open_from_previous: previousObs.filter((o) => o.is_open),
  };
});

on('GET', '/history/trains', ({ q }) => {
  const term = q.get('q')?.toLowerCase();
  const limit = num(q.get('limit')) ?? 50;
  const data = where('trains', (t) => {
    if (!t.active) return false;
    if (!term) return true;
    return contains(t.name, term) || contains(t.number, term);
  })
    .map((t): Row => {
      const trainInspections = where('inspections', (i) => i.train_id === t.id);
      const trainObservations = where('observations', (o) => o.train_id === t.id);
      return {
        ...t,
        inspections: trainInspections.length,
        observations: trainObservations.length,
        pending: trainObservations.filter((o) => !['closed', 'cancelled'].includes(o.status)).length,
        last_inspected_at: trainInspections.map((i) => i.created_at).sort().pop() ?? null,
      };
    })
    .sort((a, b) => b.inspections - a.inspections || String(a.number).localeCompare(String(b.number)))
    .slice(0, limit);
  return { data };
});

on('GET', '/history/trains/:id', ({ params }) => {
  const train = byId('trains', params[0]);
  if (!train) throw notFound('Train');
  const trainInspections = inspections()
    .filter((i) => i.train_id === train.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rows = observations()
    .filter((o) => o.train_id === train.id)
    .sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)));
  return {
    train,
    summary: {
      inspections: trainInspections.length,
      observations: rows.length,
      pending: rows.filter((o) => o.is_open).length,
      overdue: rows.filter((o) => o.is_overdue).length,
      closed: rows.filter((o) => o.status === 'closed').length,
      critical: rows.filter((o) => o.severity_rank === 1).length,
      by_coach: countBy(rows, (o) => o.coach ?? o.unit_name ?? 'Not specified'),
      by_department: countBy(rows, (o) => o.department_name),
    },
    inspections: trainInspections,
    observations: rows,
  };
});

/* -------------------------------- search ---------------------------------- */

on('GET', '/search', ({ q, user }) => {
  const term = (q.get('q') ?? '').trim().toLowerCase();
  const limit = num(q.get('limit')) ?? 6;
  if (!term) throw bad('q is required');

  const stations = where('stations', (s) => s.active && (contains(s.name, term) || contains(s.code, term)))
    .slice(0, limit)
    .map((s) => ({ ...stationView(s) }));
  const trains = where('trains', (t) => t.active && (contains(t.name, term) || contains(t.number, term))).slice(0, limit);
  const supervisors = where('supervisors', (s) => s.active && (contains(s.name, term) || contains(s.employee_id, term)))
    .slice(0, limit)
    .map((s) => ({
      ...s,
      department_name: byId('departments', s.department_id)?.name,
      station_name: byId('stations', s.station_id)?.name ?? null,
    }));
  const inspectionRows = inspections()
    .filter((i) => contains(i.ref_no, term) || contains(i.title, term) || contains(i.station_name, term))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
  const params = new URLSearchParams({ q: term, page_size: String(limit) });
  const observationPage = page(filterObservations(params, user), params, limit);

  return {
    query: q.get('q'),
    stations,
    trains,
    supervisors,
    inspections: inspectionRows,
    observations: observationPage.data,
    totals: {
      stations: stations.length,
      trains: trains.length,
      supervisors: supervisors.length,
      inspections: inspectionRows.length,
      observations: observationPage.total,
    },
  };
});

/* ----------------------------- notifications ------------------------------ */

on('GET', '/notifications', ({ q, user }) => {
  const unread = bool(q.get('unread')) === true;
  const limit = num(q.get('limit')) ?? 50;
  const data = where('notifications', (n) => n.user_id === user.id && (!unread || !n.read_at))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    .slice(0, limit)
    .map((n) => {
      const observation = n.observation_id ? observationById(n.observation_id) : undefined;
      return {
        ...n,
        observation_ref: observation?.ref_no ?? null,
        observation_status: observation?.status ?? null,
        station_name: observation?.station_name ?? null,
        unit_name: observation?.unit_name ?? null,
        item_name: observation?.item_name ?? null,
        severity_name: observation?.severity_name ?? null,
        tdc: observation?.tdc ?? null,
        delivery_status: where('notification_deliveries', (d) => d.notification_id === n.id)
          .map((d) => `${d.channel}:${d.status}`)
          .join(', '),
      };
    });
  return {
    unread_count: where('notifications', (n) => n.user_id === user.id && !n.read_at).length,
    data,
  };
});

on('POST', '/notifications/:id/read', ({ params, user }) => {
  const notification = byId('notifications', params[0]);
  if (!notification || notification.user_id !== user.id) throw notFound('Notification');
  if (!notification.read_at) update('notifications', notification.id, { read_at: nowIso() });
  return { ok: true };
});

on('POST', '/notifications/read-all', ({ user }) => {
  let updated = 0;
  for (const n of where('notifications', (row) => row.user_id === user.id && !row.read_at)) {
    update('notifications', n.id, { read_at: nowIso() });
    updated += 1;
  }
  return { ok: true, updated };
});

on('GET', '/notifications/deliveries', ({ q, user }) => {
  const observationId = num(q.get('observation_id'));
  const status = q.get('status');
  const limit = num(q.get('limit')) ?? 100;
  const data = table('notification_deliveries')
    .map((d): Row | null => {
      const notification = byId('notifications', d.notification_id);
      return notification ? { ...d, notification } : null;
    })
    .filter((d): d is Row => d !== null)
    .filter((d) => {
      if (!isAdmin(user) && d.notification.user_id !== user.id) return false;
      if (observationId !== undefined && d.notification.observation_id !== observationId) return false;
      if (status && d.status !== status) return false;
      return true;
    })
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .map((d) => ({
      ...d,
      event: d.notification.event,
      title: d.notification.title,
      observation_id: d.notification.observation_id,
      observation_ref: d.notification.observation_id ? byId('observations', d.notification.observation_id)?.ref_no : null,
      recipient_name: byId('users', d.notification.user_id)?.name ?? '',
      recipient_role: byId('users', d.notification.user_id)?.role ?? '',
      notification: undefined,
    }));
  return { data };
});

/* -------------------------------- reports --------------------------------- */

const REPORT_CATALOGUE = [
  { key: 'inspection', name: 'Inspection Report', path: '/api/reports/inspection/:id', description: 'Full record of one inspection with observations, evidence and signatures' },
  { key: 'compliance', name: 'Compliance Report', path: '/api/reports/compliance', description: 'Action taken, compliance date, verification and closure' },
  { key: 'pending', name: 'Pending Report', path: '/api/reports/pending', description: 'Every observation awaiting compliance' },
  { key: 'overdue', name: 'Overdue Report', path: '/api/reports/overdue', description: 'Observations past their target date of compliance' },
  { key: 'department-wise', name: 'Department-wise Report', path: '/api/reports/department-wise', description: 'Workload and closure performance by department' },
  { key: 'station-wise', name: 'Station-wise Report', path: '/api/reports/station-wise', description: 'Observations, pendency and repeats by station' },
  { key: 'repeated-deficiency', name: 'Repeated Deficiency Report', path: '/api/reports/repeated-deficiency', description: 'Recurring deficiencies with occurrence counts' },
  { key: 'module-wise', name: 'Module-wise Report', path: '/api/reports/module-wise', description: 'Passenger Amenities, Commercial and Safe Running side by side' },
];

on('GET', '/reports/catalogue', () => ({ formats: ['json', 'csv'], data: REPORT_CATALOGUE }));

const reportRows = (key: string, q: URLSearchParams, user: Row): { title: string; rows: Row[] } => {
  const params = new URLSearchParams(q);
  if (key === 'pending') params.set('open', '1');
  if (key === 'overdue') params.set('overdue', '1');
  if (key === 'critical') params.set('critical', '1');
  const rows = filterObservations(params, user);

  if (key === 'pending' || key === 'overdue' || key === 'critical' || key === 'observations') {
    return {
      title: { pending: 'Pending Observations Report', overdue: 'Overdue Observations Report', critical: 'Critical Observations Report', observations: 'Observation Register' }[key]!,
      rows: rows.map((o) => ({
        observation_id: o.ref_no, module: o.module_name, station: o.location_label,
        unit: o.unit_name, item: o.item_name, observation: o.observation,
        severity: o.severity_name, action_by: o.department_name, supervisor: o.supervisor_name,
        tdc: o.tdc, status: o.status, overdue: o.is_overdue ? 'Yes' : 'No',
        repeated: o.repeat_count, inspecting_officer: o.inspector_name,
        observed_on: dateOnly(o.observed_at),
      })),
    };
  }
  if (key === 'module-wise') {
    return {
      title: 'Module-wise Report',
      rows: activeRows('modules').map((m) => {
        const group = rows.filter((o) => o.module_id === m.id);
        return {
          module: m.name, code: m.code, total: group.length,
          pending: group.filter((o) => o.is_open).length,
          overdue: group.filter((o) => o.is_overdue).length,
          closed: group.filter((o) => o.status === 'closed').length,
          critical: group.filter((o) => o.severity_rank === 1).length,
          repeated: group.filter((o) => o.repeat_count > 0).length,
        };
      }),
    };
  }
  if (key === 'department-wise') {
    return {
      title: 'Department-wise Report',
      rows: [...groupBy(rows, (o) => o.department_name).entries()].map(([department, group]) => {
        const durations = group.map(closureDays).filter((d): d is number => d !== null);
        return {
          department: String(department), total: group.length,
          pending: group.filter((o) => o.is_open).length,
          due_soon: group.filter((o) => o.is_open && o.days_to_tdc !== null && o.days_to_tdc >= 0 && o.days_to_tdc <= 3).length,
          overdue: group.filter((o) => o.is_overdue).length,
          compliance_submitted: group.filter((o) => o.status === 'compliance_submitted').length,
          closed: group.filter((o) => o.status === 'closed').length,
          avg_closure_days: durations.length ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        };
      }).sort((a, b) => b.total - a.total),
    };
  }
  if (key === 'station-wise') {
    return {
      title: 'Station-wise Report',
      rows: [...groupBy(rows.filter((o) => o.station_id), (o) => o.station_id).entries()].map(([stationId, group]) => ({
        station: group[0]!.station_name, code: group[0]!.station_code, division: group[0]!.division_name,
        inspections: where('inspections', (i) => i.station_id === Number(stationId)).length,
        observations: group.length,
        pending: group.filter((o) => o.is_open).length,
        overdue: group.filter((o) => o.is_overdue).length,
        closed: group.filter((o) => o.status === 'closed').length,
        repeated: group.filter((o) => o.repeat_count > 0).length,
        amenities: group.filter((o) => o.module_code === 'PA').length,
        commercial: group.filter((o) => o.module_code === 'CI').length,
        safe_running: group.filter((o) => o.module_code === 'SR').length,
      })).sort((a, b) => b.pending - a.pending),
    };
  }
  if (key === 'repeated-deficiency') {
    const windowDays = num(q.get('days')) ?? 90;
    const recent = rows.filter((o) => Date.parse(o.observed_at) >= Date.now() - windowDays * 86_400_000 && o.item_name);
    return {
      title: 'Repeated Deficiency Report',
      rows: [...groupBy(recent, (o) => `${o.station_id}|${o.unit_name}|${o.item_name}`).entries()]
        .filter(([, group]) => group.length > 1)
        .map(([, group]) => ({
          station: group[0]!.station_name, code: group[0]!.station_code,
          unit: group[0]!.unit_name, item: group[0]!.item_name, module: group[0]!.module_name,
          occurrences: group.length,
          still_open: group.filter((o) => o.is_open).length,
          first_seen: dateOnly(group.map((o) => o.observed_at).sort()[0]),
          last_seen: dateOnly(group.map((o) => o.observed_at).sort().pop()),
          observation_ids: group.map((o) => o.ref_no).join(','),
        }))
        .sort((a, b) => b.occurrences - a.occurrences),
    };
  }
  if (key === 'compliance') {
    return {
      title: 'Compliance Report',
      rows: table('compliances')
        .map((c): Row | null => {
          const observation = observationById(c.observation_id);
          if (!observation || !inScope(observation, user)) return null;
          return {
            observation_id: observation.ref_no, station: observation.station_name,
            unit: observation.unit_name, item: observation.item_name,
            observation: observation.observation, action_by: observation.department_name,
            tdc: observation.tdc, round: c.round, action_taken: c.action_taken,
            compliance_date: dateOnly(c.compliance_date),
            submitted_by: byId('users', c.submitted_by)?.name ?? '',
            compliance_status: c.status,
            verified_by: byId('users', c.verified_by)?.name ?? null,
            verified_on: dateOnly(c.verified_at),
            rejection_reason: c.rejection_reason,
            observation_status: observation.status,
            closed_on: dateOnly(observation.closed_at),
          };
        })
        .filter((r): r is Row => r !== null)
        .sort((a, b) => String(b.compliance_date).localeCompare(String(a.compliance_date))),
    };
  }
  if (key === 'audit') {
    return {
      title: 'Audit Trail',
      rows: table('audit_log')
        .sort((a, b) => b.id - a.id)
        .slice(0, num(q.get('limit')) ?? 500)
        .map((a) => ({
          timestamp: a.created_at, user: a.user_name, role: a.role, action: a.action,
          entity: a.entity_type, entity_id: a.entity_id, remarks: a.remarks,
          previous_value: a.previous_value, new_value: a.new_value, ip: a.ip,
        })),
    };
  }
  return { title: 'Report', rows: [] };
};

on('GET', '/reports/:key', ({ params, q, user }) => {
  const key = params[0]!;
  if (key === 'catalogue') throw notFound('Report');
  const format = q.get('format') ?? 'json';
  const { title, rows } = reportRows(key, q, user);
  if (format !== 'json') {
    throw new DemoError(
      501, 'DEMO_LIMITATION',
      `${format.toUpperCase()} export is generated by the server and is not available in the offline demonstration build. The preview below shows the same data.`
    );
  }
  return { title, subtitle: 'Offline demonstration build', generated_at: nowIso(), count: rows.length, data: rows };
});

on('GET', '/reports/inspection/:id', ({ params }) => {
  const inspection = byId('inspections', params[0]);
  if (!inspection) throw notFound('Inspection');
  return {
    inspection: viewInspection(inspection),
    observations: where('observations', (o) => o.inspection_id === inspection.id).map(viewObservation),
    approvals: where('approvals', (a) => a.entity_type === 'inspection' && a.entity_id === inspection.id),
    auto_summary: buildSummary(inspection.id),
  };
});

/* ---------------------------------- sync ---------------------------------- */

on('GET', '/sync/snapshot', () => ({
  generated_at: nowIso(),
  version: 1,
  modules: activeRows('modules'),
  inspection_types: activeRows('inspection_types'),
  departments: activeRows('departments'),
  severities: where('severities', (s) => s.active !== 0).sort((a, b) => a.rank - b.rank),
  observation_categories: activeRows('observation_categories'),
  item_parameters: activeRows('item_parameters'),
  item_groups: activeRows('item_groups'),
  inspection_items: where('inspection_items', (i) => i.active !== 0),
  stations: where('stations', (s) => s.active !== 0).map(stationView),
  trains: where('trains', (t) => t.active !== 0),
  units: where('units', (u) => u.active !== 0),
  supervisors: where('supervisors', (s) => s.active !== 0),
  supervisor_coverage: where('supervisor_coverage', (c) => c.active !== 0),
  rule_references: activeRows('rule_references'),
}));

on('GET', '/sync/status', ({ user }) => ({
  server_time: nowIso(),
  user: { id: user.id, name: user.name, role: user.role },
  pending_for_me: where('observations', (o) => o.created_by === user.id && !['closed', 'cancelled'].includes(o.status)).length,
}));

on('POST', '/sync/batch', ({ body, user }) => {
  const results: Row[] = [];
  const created = new Map<string, number>();
  for (const op of body?.operations ?? []) {
    try {
      if (op.type === 'inspection') {
        const existing = table('inspections').find((i) => i.client_uuid === op.client_uuid);
        if (existing) {
          created.set(op.client_uuid, existing.id);
          results.push({ client_uuid: op.client_uuid, type: op.type, status: 'duplicate', id: existing.id, ref_no: existing.ref_no });
          continue;
        }
        const handler = routes.find((r) => r.method === 'POST' && r.pattern.test('/inspections'))!;
        const inspection = handler.handler({
          params: [], q: new URLSearchParams(), method: 'POST', user,
          body: { ...op.payload, client_uuid: op.client_uuid },
        }) as Row;
        created.set(op.client_uuid, inspection.id);
        results.push({ client_uuid: op.client_uuid, type: op.type, status: 'created', id: inspection.id, ref_no: inspection.ref_no });
        continue;
      }
      const inspectionId =
        op.payload?.inspection_id ??
        created.get(op.inspection_client_uuid) ??
        table('inspections').find((i) => i.client_uuid === op.inspection_client_uuid)?.id;
      if (!inspectionId) {
        results.push({ client_uuid: op.client_uuid, type: op.type, status: 'failed', error: 'Parent inspection has not been synced yet' });
        continue;
      }
      const handler = routes.find((r) => r.method === 'POST' && r.pattern.test('/observations'))!;
      const observation = handler.handler({
        params: [], q: new URLSearchParams(), method: 'POST', user,
        body: { ...op.payload, inspection_id: inspectionId, client_uuid: op.client_uuid },
      }) as Row;
      results.push({
        client_uuid: op.client_uuid, type: op.type,
        status: observation.deduplicated ? 'duplicate' : 'created',
        id: observation.id, ref_no: observation.ref_no,
        repeat_count: observation.repeat_count, supervisor_name: observation.supervisor_name,
        notification_recipients: observation.notification?.recipients ?? 0,
      });
    } catch (error) {
      results.push({
        client_uuid: op.client_uuid, type: op.type, status: 'failed',
        error: error instanceof Error ? error.message : 'Failed',
      });
    }
  }
  return {
    synced_at: nowIso(),
    summary: {
      total: results.length,
      created: results.filter((r) => r.status === 'created').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      failed: results.filter((r) => r.status === 'failed').length,
    },
    results,
  };
});

/* --------------------------------- admin ---------------------------------- */

const RESOURCES: Record<string, { table: string; label: string; columns: string[]; search?: string[] }> = {
  zones: { table: 'zones', label: 'Zone', columns: ['code', 'name', 'active'] },
  divisions: { table: 'divisions', label: 'Division', columns: ['code', 'name', 'zone_id', 'active'] },
  departments: { table: 'departments', label: 'Department', columns: ['code', 'name', 'is_external', 'sort_order', 'active'] },
  stations: { table: 'stations', label: 'Station', columns: ['code', 'name', 'division_id', 'zone_id', 'category', 'station_type', 'platforms', 'latitude', 'longitude', 'active'], search: ['code', 'name'] },
  trains: { table: 'trains', label: 'Train', columns: ['number', 'name', 'origin_code', 'origin', 'destination_code', 'destination', 'train_type', 'has_pantry', 'active'], search: ['number', 'name'] },
  units: { table: 'units', label: 'Unit / Area', columns: ['name', 'applies_to', 'station_id', 'kind', 'sort_order', 'active'], search: ['name'] },
  modules: { table: 'modules', label: 'Module', columns: ['code', 'name', 'tagline', 'description', 'accent', 'sort_order', 'active'] },
  inspection_types: { table: 'inspection_types', label: 'Inspection type', columns: ['name', 'module_id', 'sort_order', 'active'] },
  item_groups: { table: 'item_groups', label: 'Item group', columns: ['module_id', 'name', 'sort_order', 'active'] },
  inspection_items: { table: 'inspection_items', label: 'Inspection item', columns: ['group_id', 'module_id', 'name', 'applies_to', 'default_department_id', 'default_category_id', 'default_severity_id', 'rule_reference_id', 'sort_order', 'active'], search: ['name'] },
  item_parameters: { table: 'item_parameters', label: 'Checklist parameter', columns: ['name', 'polarity', 'sort_order', 'active'] },
  observation_categories: { table: 'observation_categories', label: 'Observation category', columns: ['name', 'sort_order', 'active'] },
  severities: { table: 'severities', label: 'Severity', columns: ['name', 'definition', 'rank', 'default_tdc_days', 'notify_immediately', 'escalate_immediately', 'accent', 'active'] },
  supervisors: { table: 'supervisors', label: 'Supervisor', columns: ['employee_id', 'name', 'designation', 'department_id', 'sub_department', 'station_id', 'section', 'area_of_responsibility', 'mobile', 'email', 'reporting_officer_id', 'user_id', 'is_default_for_department', 'active'], search: ['name', 'employee_id', 'designation'] },
  supervisor_coverage: { table: 'supervisor_coverage', label: 'Supervisor coverage', columns: ['supervisor_id', 'station_id', 'unit_id', 'unit_kind', 'item_group_id', 'priority', 'active'] },
  contractors: { table: 'contractors', label: 'Contractor / Licensee', columns: ['name', 'party_type', 'contract_ref', 'scope', 'station_id', 'department_id', 'contact_person', 'mobile', 'email', 'valid_from', 'valid_to', 'security_deposit', 'licence_fee', 'active'], search: ['name', 'contract_ref'] },
  rule_references: { table: 'rule_references', label: 'Rule / instruction', columns: ['code', 'title', 'authority', 'reference_no', 'issued_on', 'url', 'notes', 'active'], search: ['code', 'title'] },
  tdc_rules: { table: 'tdc_rules', label: 'TDC rule', columns: ['name', 'severity_id', 'remind_before_days', 'remind_on_due_date', 'overdue_repeat_days', 'escalate_after_days', 'escalate_to_role', 'active'] },
  notification_rules: { table: 'notification_rules', label: 'Notification rule', columns: ['event', 'recipients', 'in_app', 'email', 'sms', 'template_title', 'template_body', 'active'] },
  escalation_levels: { table: 'escalation_levels', label: 'Escalation level', columns: ['level', 'name', 'after_days', 'target_role', 'target_designation', 'notes', 'active'] },
  item_parameter_map: { table: 'item_parameter_map', label: 'Item parameter mapping', columns: ['item_id', 'parameter_id', 'sort_order'] },
};

const requireAdminArea = (user: Row) => {
  if (!isAdmin(user) && !isOfficer(user)) throw forbidden('This action is restricted to: admin, divisional_officer');
};

on('GET', '/admin/resources', ({ user }) => {
  requireAdminArea(user);
  return {
    data: Object.entries(RESOURCES).map(([key, def]) => ({
      key, label: def.label, columns: def.columns,
      count: table(def.table).length, searchable: Boolean(def.search),
    })),
  };
});

on('GET', '/admin/masters/:resource', ({ params, q, user }) => {
  requireAdminArea(user);
  const def = RESOURCES[params[0]!];
  if (!def) throw notFound(`Master "${params[0]}"`);
  const term = q.get('q')?.toLowerCase();
  const activeFilter = q.get('active');
  const rows = table(def.table).filter((row) => {
    if (term && def.search && !def.search.some((column) => contains(row[column], term))) return false;
    if ((activeFilter === '1' || activeFilter === '0') && def.columns.includes('active')) {
      return Number(row.active ?? 0) === Number(activeFilter);
    }
    return true;
  });
  return {
    resource: params[0], label: def.label, columns: def.columns,
    total: rows.length, data: rows.slice(0, num(q.get('limit')) ?? 200),
  };
});

const sanitise = (def: { columns: string[] }, payload: Row) =>
  Object.fromEntries(Object.entries(payload ?? {}).filter(([k, v]) => def.columns.includes(k) && v !== undefined));

on('POST', '/admin/masters/:resource', ({ params, body, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const def = RESOURCES[params[0]!];
  if (!def) throw notFound(`Master "${params[0]}"`);
  const values = sanitise(def, body);
  if (!Object.keys(values).length) throw bad('No valid fields supplied');
  const created = insert(def.table, { active: 1, ...values });
  audit({ action: 'MASTER_CREATE', entityType: params[0]!, entityId: created.id, user, next: created });
  return created;
});

on('PATCH', '/admin/masters/:resource/:id', ({ params, body, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const def = RESOURCES[params[0]!];
  if (!def) throw notFound(`Master "${params[0]}"`);
  const row = byId(def.table, params[1]);
  if (!row) throw notFound(def.label);
  const previous = { ...row };
  const values = sanitise(def, body);
  if (!Object.keys(values).length) throw bad('No valid fields supplied');
  update(def.table, row.id, values);
  audit({ action: 'MASTER_UPDATE', entityType: params[0]!, entityId: row.id, user, previous, next: row });
  return row;
});

on('DELETE', '/admin/masters/:resource/:id', ({ params, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const def = RESOURCES[params[0]!];
  if (!def) throw notFound(`Master "${params[0]}"`);
  const row = byId(def.table, params[1]);
  if (!row) throw notFound(def.label);
  if (def.columns.includes('active')) {
    const previous = { ...row };
    update(def.table, row.id, { active: 0 });
    audit({ action: 'MASTER_DEACTIVATE', entityType: params[0]!, entityId: row.id, user, previous, next: row });
    return { ok: true, deactivated: true, data: row };
  }
  const list = table(def.table);
  list.splice(list.findIndex((r) => r.id === row.id), 1);
  audit({ action: 'MASTER_DELETE', entityType: params[0]!, entityId: row.id, user, previous: row });
  return { ok: true, deleted: true };
});

on('PUT', '/admin/items/:id/parameters', ({ params, body, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const item = byId('inspection_items', params[0]);
  if (!item) throw notFound('Inspection item');
  const list = table('item_parameter_map');
  const previous = list.filter((m) => m.item_id === item.id).map((m) => m.parameter_id);
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]!.item_id === item.id) list.splice(i, 1);
  (body?.parameter_ids ?? []).forEach((parameterId: number, index: number) =>
    insert('item_parameter_map', { item_id: item.id, parameter_id: parameterId, sort_order: index * 10 })
  );
  audit({ action: 'ITEM_PARAMETERS_SET', entityType: 'inspection_items', entityId: item.id, user, previous, next: body?.parameter_ids });
  return {
    ok: true,
    data: where('item_parameter_map', (m) => m.item_id === item.id).map((m) => byId('item_parameters', m.parameter_id)),
  };
});

on('GET', '/admin/users', ({ q, user }) => {
  requireAdminArea(user);
  const term = q.get('q')?.toLowerCase();
  const role = q.get('role');
  return {
    data: table('users')
      .filter((u) => {
        if (term && !(contains(u.name, term) || contains(u.employee_id, term))) return false;
        if (role && u.role !== role) return false;
        return true;
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((u) => ({
        ...u,
        department_name: byId('departments', u.department_id)?.name ?? null,
        division_name: byId('divisions', u.division_id)?.name ?? null,
        station_name: byId('stations', u.station_id)?.name ?? null,
        supervisor_records: where('supervisors', (s) => s.user_id === u.id).length,
      })),
  };
});

on('POST', '/admin/users', ({ body, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  if (table('users').some((u) => String(u.employee_id).toLowerCase() === String(body?.employee_id ?? '').toLowerCase())) {
    throw new DemoError(409, 'DUPLICATE', 'A record with these details already exists');
  }
  const created = insert('users', {
    ...body,
    active: body?.active === undefined ? 1 : Number(body.active),
    must_change_password: 1,
    last_login_at: null,
    created_at: nowIso(),
  });
  audit({ action: 'USER_CREATE', entityType: 'user', entityId: created.id, user, next: { ...created, password: '***' } });
  return { ...publicUser(created), temporary_password: `Rail@${Math.floor(100000 + Math.random() * 899999)}` };
});

on('PATCH', '/admin/users/:id', ({ params, body, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const row = byId('users', params[0]);
  if (!row) throw notFound('User');
  if (row.role === 'admin' && body?.active === false) {
    const admins = where('users', (u) => u.role === 'admin' && u.active).length;
    if (admins <= 1) throw bad('At least one active administrator must remain');
  }
  const previous = { ...row };
  update('users', row.id, { ...body, active: body?.active === undefined ? row.active : Number(body.active) });
  audit({ action: 'USER_UPDATE', entityType: 'user', entityId: row.id, user, previous, next: row });
  return publicUser(row);
});

on('POST', '/admin/users/:id/reset-password', ({ params, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const row = byId('users', params[0]);
  if (!row) throw notFound('User');
  update('users', row.id, { must_change_password: 1 });
  audit({ action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: row.id, user });
  return { ok: true, temporary_password: `Rail@${Math.floor(100000 + Math.random() * 899999)}` };
});

on('GET', '/admin/settings', ({ user }) => {
  requireAdminArea(user);
  return { data: table('settings').sort((a, b) => String(a.category).localeCompare(String(b.category))) };
});

on('PUT', '/admin/settings', ({ body, user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const changed: Row[] = [];
  for (const [key, value] of Object.entries(body?.values ?? {})) {
    const row = table('settings').find((s) => s.key === key);
    const stored = value === null ? null : String(value);
    if (row) {
      changed.push({ key, from: row.value, to: stored });
      Object.assign(row, { value: stored, updated_at: nowIso(), updated_by: user.id });
    } else {
      insert('settings', { key, value: stored, value_type: 'string', label: key, category: 'general', updated_at: nowIso(), updated_by: user.id });
      changed.push({ key, from: null, to: stored });
    }
  }
  audit({ action: 'SETTINGS_UPDATE', entityType: 'settings', entityId: null, user, next: changed });
  return { ok: true, data: table('settings') };
});

on('GET', '/admin/audit', ({ q, user }) => {
  requireAdminArea(user);
  const term = q.get('q')?.toLowerCase();
  const action = q.get('action');
  const entityType = q.get('entity_type');
  const entityId = q.get('entity_id');
  const rows = table('audit_log')
    .filter((a) => {
      if (action && a.action !== action) return false;
      if (entityType && a.entity_type !== entityType) return false;
      if (entityId && String(a.entity_id) !== entityId) return false;
      if (term && !(contains(a.user_name, term) || contains(a.action, term) || contains(a.remarks, term))) return false;
      return true;
    })
    .sort((a, b) => b.id - a.id)
    .map((a) => ({
      ...a,
      previous_value: safeJson(a.previous_value),
      new_value: safeJson(a.new_value),
    }));
  return {
    ...page(rows, q, 50),
    actions: [...new Set(table('audit_log').map((a) => a.action))].sort(),
  };
});

const safeJson = (value: unknown) => {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

on('GET', '/admin/stats', ({ user }) => {
  requireAdminArea(user);
  const tables = [
    'users', 'stations', 'trains', 'units', 'supervisors', 'inspection_items',
    'inspections', 'observations', 'compliances', 'attachments', 'notifications',
    'notification_deliveries', 'audit_log', 'observation_events',
  ];
  const deliveries = new Map<string, number>();
  for (const d of table('notification_deliveries')) {
    const key = `${d.channel}|${d.status}`;
    deliveries.set(key, (deliveries.get(key) ?? 0) + 1);
  }
  return {
    environment: 'offline demonstration build',
    scheduler: { enabled: false, cron: '30 7 * * *', timezone: 'Asia/Kolkata' },
    notifications: { email_enabled: false, sms_enabled: false },
    session_timeout_minutes: 60,
    counts: Object.fromEntries(tables.map((t) => [t, table(t).length])),
    delivery_status: [...deliveries.entries()].map(([key, n]) => {
      const [channel, status] = key.split('|');
      return { channel, status, n };
    }),
    database_file: 'in-browser (demonstration data)',
  };
});

on('POST', '/admin/scheduler/run', ({ user }) => {
  if (!isAdmin(user)) throw forbidden('This action is restricted to: admin');
  const rows = observations().filter((o) => o.tdc && isOpenStatus(o.status));
  const summary = { as_of: todayIso(), scanned: rows.length, before_due: 0, on_due: 0, overdue: 0, escalated: 0 };
  for (const o of rows) {
    const diff = o.days_to_tdc ?? 0;
    if (diff > 0 && diff <= 2) summary.before_due += 1;
    else if (diff === 0) summary.on_due += 1;
    else if (diff < 0) {
      summary.overdue += 1;
      if (Math.abs(diff) >= 3 && o.escalation_level < 1) {
        update('observations', o.id, { escalation_level: 1 });
        summary.escalated += 1;
      }
    }
  }
  audit({ action: 'SCHEDULER_RUN', entityType: 'scheduler', entityId: null, user, next: summary });
  return summary;
});

on('POST', '/admin/backup', () => {
  throw new DemoError(501, 'DEMO_LIMITATION', 'Backups are taken by the server and are not available in the offline demonstration build.');
});

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

export interface DemoRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  token: string | null;
  body: any;
}

export function handle({ method, path, query, token, body }: DemoRequest): unknown {
  if (path === '/health') {
    return { status: 'ok', service: 'railway-inspection-demo', environment: 'offline', time: nowIso() };
  }
  const route = routes.find((r) => r.method === method && r.pattern.test(path));
  if (!route) throw new DemoError(404, 'NOT_FOUND', `No route for ${method} ${path}`);
  const user = route.anonymous ? ({} as Row) : sessionUser(token);
  const match = route.pattern.exec(path)!;
  return route.handler({
    params: match.slice(1).map((p) => decodeURIComponent(p)),
    q: query,
    body,
    user,
    method,
  });
}

/** Evidence is served as an embedded data URL rather than from disk. */
export function demoImage(storedName: string): string {
  const attachment = table('attachments').find((a) => a.stored_name === storedName);
  const phase = attachment?.phase === 'compliance' ? 'compliance' : 'observation';
  const alternate = (attachment?.id ?? 0) % 2 === 1;
  return images[alternate ? `${phase}_alt` : phase] ?? images.observation;
}

export const demoMeta = meta;
