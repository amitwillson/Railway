import { all, get } from '../db/index.js';

export const OPEN_STATUSES = [
  'submitted', 'assigned', 'acknowledged', 'in_progress', 'rejected', 'reopened',
];
export const CLOSED_STATUSES = ['closed', 'cancelled'];

const csv = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Row-level access scope.
 *   admin                - everything
 *   divisional_officer   - their division (all divisions when none is set)
 *   inspector            - their division, plus anything they raised
 *   supervisor           - observations assigned to them, or to their
 *                          department at their station
 *   viewer               - their division, read only
 */
export function scopeClause(user, { table = 'o' } = {}) {
  if (!user || user.role === 'admin') return { sql: '1=1', params: [] };

  if (user.role === 'supervisor') {
    const sup = get('SELECT id, department_id, station_id FROM supervisors WHERE user_id = ?', [user.id]);
    const parts = [];
    const params = [];
    if (sup?.id) {
      parts.push(`${table}.supervisor_id = ?`);
      params.push(sup.id);
    }
    const deptId = sup?.department_id ?? user.department_id;
    const stationId = sup?.station_id ?? user.station_id;
    if (deptId && stationId) {
      parts.push(`(${table}.action_by_department_id = ? AND ${table}.station_id = ?)`);
      params.push(deptId, stationId);
    } else if (deptId) {
      parts.push(`${table}.action_by_department_id = ?`);
      params.push(deptId);
    }
    parts.push(`${table}.created_by = ?`);
    params.push(user.id);
    return { sql: `(${parts.join(' OR ')})`, params };
  }

  if (user.division_id) {
    return {
      sql: `(${table}.station_id IS NULL OR ${table}.station_id IN (SELECT id FROM stations WHERE division_id = ?) OR ${table}.created_by = ?)`,
      params: [user.division_id, user.id],
    };
  }
  return { sql: '1=1', params: [] };
}

/**
 * Access scope for inspections: the same rules as observations, expressed over
 * the inspection row (which has an inspector rather than a supervisor).
 */
export function inspectionScopeClause(user, { table = 'i' } = {}) {
  if (!user || user.role === 'admin') return { sql: '1=1', params: [] };

  if (user.role === 'supervisor') {
    const parts = [`${table}.inspector_id = ?`];
    const params = [user.id];
    if (user.station_id) {
      parts.push(`${table}.station_id = ?`);
      params.push(user.station_id);
    }
    parts.push(
      `EXISTS (SELECT 1 FROM observations o2
                 JOIN supervisors s2 ON s2.id = o2.supervisor_id
                WHERE o2.inspection_id = ${table}.id AND s2.user_id = ?)`
    );
    params.push(user.id);
    return { sql: `(${parts.join(' OR ')})`, params };
  }

  if (user.division_id) {
    return {
      sql: `(${table}.station_id IS NULL OR ${table}.station_id IN (SELECT id FROM stations WHERE division_id = ?) OR ${table}.inspector_id = ?)`,
      params: [user.division_id, user.id],
    };
  }
  return { sql: '1=1', params: [] };
}

/**
 * Translates API query parameters into a WHERE clause over v_observations.
 * Every dashboard, list and report in the application funnels through here so
 * that filters behave identically everywhere.
 */
export function observationFilter(q = {}, user = null, { table = 'o' } = {}) {
  const where = [];
  const params = [];
  const eq = (column, value) => {
    if (value === undefined || value === null || value === '') return;
    where.push(`${table}.${column} = ?`);
    params.push(value);
  };

  eq('station_id', q.station_id);
  eq('train_id', q.train_id);
  eq('module_id', q.module_id);
  eq('action_by_department_id', q.department_id);
  eq('supervisor_id', q.supervisor_id);
  eq('severity_id', q.severity_id);
  eq('category_id', q.category_id);
  eq('item_id', q.item_id);
  eq('unit_id', q.unit_id);
  eq('inspection_id', q.inspection_id);
  eq('created_by', q.created_by);

  if (q.module_code) {
    where.push(`${table}.module_code = ?`);
    params.push(q.module_code);
  }
  if (q.division_id) {
    where.push(`${table}.station_id IN (SELECT id FROM stations WHERE division_id = ?)`);
    params.push(q.division_id);
  }
  if (q.status) {
    const list = csv(q.status);
    if (list.length) {
      where.push(`${table}.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  if (q.open) {
    where.push(`${table}.status NOT IN ('closed','cancelled')`);
  }
  if (q.closed) {
    where.push(`${table}.status = 'closed'`);
  }
  if (q.overdue) {
    where.push(`${table}.is_overdue = 1`);
  }
  if (q.due_soon) {
    where.push(`${table}.is_open = 1 AND ${table}.days_to_tdc IS NOT NULL AND ${table}.days_to_tdc BETWEEN 0 AND 3`);
  }
  if (q.awaiting_verification) {
    where.push(`${table}.status = 'compliance_submitted'`);
  }
  if (q.repeated) {
    where.push(`${table}.repeat_count > 0`);
  }
  if (q.critical) {
    where.push(`${table}.severity_rank = 1`);
  }
  if (q.has_tdc === true) where.push(`${table}.tdc IS NOT NULL`);
  if (q.has_tdc === false) where.push(`${table}.tdc IS NULL`);

  if (q.mine && user) {
    where.push(`${table}.created_by = ?`);
    params.push(user.id);
  }
  if (q.assigned_to_me && user) {
    const sup = get('SELECT id FROM supervisors WHERE user_id = ?', [user.id]);
    if (sup?.id) {
      where.push(`${table}.supervisor_id = ?`);
      params.push(sup.id);
    } else if (user.department_id) {
      where.push(`${table}.action_by_department_id = ?`);
      params.push(user.department_id);
    } else {
      where.push('1=0');
    }
  }
  if (q.from) {
    where.push(`date(${table}.observed_at) >= date(?)`);
    params.push(q.from);
  }
  if (q.to) {
    where.push(`date(${table}.observed_at) <= date(?)`);
    params.push(q.to);
  }
  if (q.tdc_from) {
    where.push(`date(${table}.tdc) >= date(?)`);
    params.push(q.tdc_from);
  }
  if (q.tdc_to) {
    where.push(`date(${table}.tdc) <= date(?)`);
    params.push(q.tdc_to);
  }
  if (q.days) {
    where.push(`julianday('now') - julianday(${table}.observed_at) <= ?`);
    params.push(q.days);
  }
  if (q.q) {
    const like = `%${String(q.q).toLowerCase()}%`;
    where.push(
      `(lower(${table}.ref_no) LIKE ? OR lower(${table}.observation) LIKE ? OR lower(COALESCE(${table}.item_name,'')) LIKE ?
        OR lower(COALESCE(${table}.unit_name,'')) LIKE ? OR lower(COALESCE(${table}.station_name,'')) LIKE ?
        OR lower(COALESCE(${table}.station_code,'')) LIKE ? OR lower(COALESCE(${table}.supervisor_name,'')) LIKE ?
        OR lower(COALESCE(${table}.train_number,'')) LIKE ? OR lower(COALESCE(${table}.inspector_name,'')) LIKE ?)`
    );
    params.push(like, like, like, like, like, like, like, like, like);
  }

  const scope = scopeClause(user, { table });
  if (scope.sql !== '1=1') {
    where.push(scope.sql);
    params.push(...scope.params);
  }

  return { sql: where.length ? where.join(' AND ') : '1=1', params };
}

const SORTS = {
  newest: 'o.observed_at DESC, o.id DESC',
  oldest: 'o.observed_at ASC, o.id ASC',
  tdc: 'o.tdc IS NULL, date(o.tdc) ASC',
  severity: 'o.severity_rank ASC, o.observed_at DESC',
  overdue: 'o.is_overdue DESC, o.days_to_tdc ASC',
  status: 'o.status ASC, o.observed_at DESC',
};

/** Paged list over v_observations honouring filters, scope and sort order. */
export function listObservations(q = {}, user = null) {
  const { sql, params } = observationFilter(q, user);
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.page_size) || 25));
  const order = SORTS[q.sort] ?? SORTS.newest;
  const total = get(`SELECT COUNT(*) AS n FROM v_observations o WHERE ${sql}`, params).n;
  const rows = all(
    `SELECT * FROM v_observations o WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    data: rows.map(decorate),
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Adds derived booleans + parsed JSON so clients never re-implement them. */
export function decorate(row) {
  if (!row) return row;
  let parameters = [];
  try {
    parameters = row.parameters ? JSON.parse(row.parameters) : [];
  } catch {
    parameters = [];
  }
  return {
    ...row,
    parameters,
    is_overdue: !!row.is_overdue,
    is_open: !!row.is_open,
    requires_physical_verification: !!row.requires_physical_verification,
    location_label: row.station_name
      ? `${row.station_name} (${row.station_code})`
      : [row.train_number, row.train_name].filter(Boolean).join(' - ') || '-',
  };
}

export const observationById = (id) =>
  decorate(get('SELECT * FROM v_observations o WHERE o.id = ?', [id]));

export const observationByRef = (ref) =>
  decorate(get('SELECT * FROM v_observations o WHERE o.ref_no = ?', [ref]));
