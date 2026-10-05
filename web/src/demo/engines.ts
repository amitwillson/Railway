/**
 * Browser ports of the server-side engines the demonstration needs to behave
 * truthfully: smart assignment, repeated-deficiency detection, the notification
 * dispatcher, the suggested-deficiency list and the inspection-note letter.
 * They follow the same rules as the server so the offline build shows the real
 * behaviour rather than a mock-up.
 */
import {
  byId, insert, nowIso, observations, table, todayIso, viewObservation, where, type Row,
} from './store';

/* ------------------------------ assignment -------------------------------- */

const matchesArea = (area: string | null, unitName: string | null) => {
  if (!area || !unitName) return false;
  const a = area.toLowerCase();
  const u = unitName.toLowerCase();
  if (a.includes(u) || u.includes(a)) return true;
  return u.split(/[^a-z0-9]+/).filter((w) => w.length > 3).some((w) => a.includes(w));
};

/** A supervisor who only covers the department ranks below one whose it is. */
const SECONDARY_DEPARTMENT_PENALTY = 2;

export function findSupervisors({
  stationId, unitId, departmentId, itemId, limit = 25,
}: {
  stationId?: number | null; unitId?: number | null;
  departmentId?: number | null; itemId?: number | null; limit?: number;
}): Row[] {
  if (!departmentId) return [];
  const unit = byId('units', unitId);
  const item = byId('inspection_items', itemId);
  const departmentLinks = where('supervisor_departments', (d) => d.active);
  const stationLinks = where('supervisor_stations', (l) => l.active);
  // Eligible = the department on the supervisor row, or an additional link to it.
  const candidates = where(
    'supervisors',
    (s) =>
      s.active
      && (s.department_id === departmentId
        || departmentLinks.some((d) => d.supervisor_id === s.id && d.department_id === departmentId))
  );
  const coverage = where('supervisor_coverage', (c) => c.active);

  const scored: Row[] = candidates.map((sup) => {
    const station = byId('stations', sup.station_id);
    const department = byId('departments', sup.department_id);
    const reportingOfficer = byId('supervisors', sup.reporting_officer_id);

    const links = stationLinks.filter((l) => l.supervisor_id === sup.id);
    const linked = links.some((l) => l.station_id === sup.station_id) || !sup.station_id
      ? links
      : [{ station_id: sup.station_id, is_primary: 1, priority: 100 }, ...links];
    const stationLink = stationId ? linked.find((l) => l.station_id === stationId) : null;
    const linkStation = stationLink ? byId('stations', stationLink.station_id) : null;

    const own = departmentLinks.filter((d) => d.supervisor_id === sup.id);
    const isPrimaryDepartment =
      sup.department_id === departmentId
      || own.some((d) => d.department_id === departmentId && d.is_primary);
    const penalty = isPrimaryDepartment ? 0 : SECONDARY_DEPARTMENT_PENALTY;
    const askedDepartment = byId('departments', departmentId);
    const departmentLabel = isPrimaryDepartment ? department?.name ?? '' : askedDepartment?.name ?? department?.name ?? '';

    let score = 70;
    let reason = `Active ${departmentLabel} supervisor`;

    if (sup.is_default_for_department) {
      score = 60;
      reason = `Nominated ${departmentLabel} supervisor`;
    }
    if (stationLink) {
      const where_ = linkStation?.name ?? 'this station';
      const isPosting = Boolean(stationLink.is_primary) || stationLink.station_id === sup.station_id;
      score = isPosting ? 50 : 55;
      reason = isPosting
        ? `Posted at ${where_} (${departmentLabel})`
        : `Covers ${where_} (${departmentLabel})`;
      if (unit && matchesArea(sup.area_of_responsibility, unit.name)) {
        score = 40;
        reason = `Responsible for ${unit.name} at ${where_}`;
      }
    }
    // The supervisor's own statement of where they work, mirroring the server:
    // it only speaks where the division's record is silent, and ranks below it.
    if (stationId && sup.user_id && score > 55) {
      const here = byId('stations', stationId);
      const mine = where('user_jurisdictions', (j) => j.active && j.user_id === sup.user_id);
      if (mine.some((j) => j.station_id === stationId)) {
        score = 57;
        reason = `Covers ${here?.name ?? 'this station'} by their own jurisdiction (${departmentLabel})`;
      } else if (here?.section && mine.some((j) => j.section === here.section)) {
        score = 58;
        reason = `Covers the ${here.section} section by their own jurisdiction (${departmentLabel})`;
      }
    }

    for (const c of coverage.filter((row) => row.supervisor_id === sup.id)) {
      const sameStation = c.station_id != null && c.station_id === stationId;
      const globalStation = c.station_id == null;
      if (!sameStation && !globalStation) continue;
      const at = linkStation?.name ?? station?.name;
      if (unit && c.unit_id && c.unit_id === unit.id) {
        score = Math.min(score, 10 + c.priority / 1000);
        reason = `Mapped to ${unit.name}${at ? ` at ${at}` : ''}`;
      } else if (unit && c.unit_kind && unit.kind && c.unit_kind === unit.kind) {
        score = Math.min(score, 20 + c.priority / 1000);
        reason = `Mapped to all ${c.unit_kind} areas`;
      } else if (item && c.item_group_id && item.group_id === c.item_group_id) {
        score = Math.min(score, 25 + c.priority / 1000);
        reason = 'Mapped to this inspection category';
      } else if (sameStation && !c.unit_id && !c.unit_kind && !c.item_group_id) {
        score = Math.min(score, 30 + c.priority / 1000);
        reason = `Mapped to ${at ?? 'this station'}`;
      }
    }
    return {
      ...sup,
      active: Boolean(sup.active),
      department_name: department?.name ?? '',
      department_code: department?.code ?? '',
      station_name: station?.name ?? null,
      station_code: station?.code ?? null,
      reporting_officer_name: reportingOfficer?.name ?? null,
      stations: linked.map((l) => {
        const st = byId('stations', l.station_id);
        return {
          id: l.id,
          station_id: l.station_id,
          station_name: st?.name ?? null,
          station_code: st?.code ?? null,
          is_primary: Boolean(l.is_primary),
          section: l.section ?? null,
        };
      }),
      departments: own.map((d) => {
        const dep = byId('departments', d.department_id);
        return {
          id: d.id,
          department_id: d.department_id,
          department_name: dep?.name ?? null,
          department_code: dep?.code ?? null,
          is_primary: Boolean(d.is_primary),
        };
      }),
      match_score: score + penalty,
      match_reason: reason,
    };
  });

  return scored
    .sort((a, b) => a.match_score - b.match_score || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

export const autoAssign = (params: Parameters<typeof findSupervisors>[0]) =>
  findSupervisors({ ...params, limit: 1 })[0] ?? null;

/* ------------------------- repeated deficiencies -------------------------- */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'not', 'with', 'this', 'that', 'from', 'has',
  'have', 'had', 'but', 'its', 'been', 'being', 'at', 'in', 'on', 'of', 'to', 'is', 'a', 'an',
  'be', 'by', 'as', 'it', 'no', 'or', 'so', 'if', 'do', 'does', 'did', 'observed', 'found',
  'noticed', 'seen', 'during', 'inspection', 'please', 'also', 'there', 'their', 'which',
]);

const stem = (word: string) =>
  word
    .replace(/(ing|ings)$/, '')
    .replace(/(tions|tion)$/, 't')
    .replace(/(ally)$/, 'al')
    .replace(/(ies)$/, 'y')
    .replace(/(es|s)$/, '')
    .replace(/(ed)$/, '');

export const keywords = (text: string) =>
  new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem)
  );

export function similarity(a: string | Set<string>, b: string | Set<string>): number {
  const setA = a instanceof Set ? a : keywords(a);
  const setB = b instanceof Set ? b : keywords(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

const TEXT_THRESHOLD = 0.45;

export function findRepeats({
  stationId, trainId, unitId, unitName, itemId, itemName, categoryId,
  observation, windowDays = 90, excludeObservationId, limit = 10,
}: {
  stationId?: number | null; trainId?: number | null;
  unitId?: number | null; unitName?: string | null;
  itemId?: number | null; itemName?: string | null;
  categoryId?: number | null; observation?: string;
  windowDays?: number; excludeObservationId?: number; limit?: number;
}) {
  if (!stationId && !trainId) return { count: 0, matches: [], window_days: windowDays, message: null };

  const itemLabel = itemName ?? byId('inspection_items', itemId)?.name ?? null;
  const unitLabel = unitName ?? byId('units', unitId)?.name ?? null;
  const cutoff = Date.now() - windowDays * 86_400_000;
  const target = keywords(observation ?? '');

  const matches = observations()
    .filter((o) => {
      if (o.status === 'cancelled') return false;
      if (excludeObservationId && o.id === excludeObservationId) return false;
      if (Date.parse(o.observed_at) < cutoff) return false;
      return stationId ? o.station_id === stationId : o.train_id === trainId;
    })
    .map((o) => {
      const sameUnit =
        (unitId && o.unit_id === unitId) ||
        Boolean(unitLabel && o.unit_name && o.unit_name.toLowerCase() === unitLabel.toLowerCase());
      const sameItem =
        (itemId && o.item_id === itemId) ||
        Boolean(itemLabel && o.item_name && o.item_name.toLowerCase() === itemLabel.toLowerCase());
      const sim = similarity(target, o.observation);

      let reason: string | null = null;
      let strength = 0;
      if (sameUnit && sameItem) {
        reason = 'Same item at the same unit';
        strength = 3;
      } else if (sameItem) {
        reason = 'Same item at this location';
        strength = 2;
      } else if (sameUnit && sim >= TEXT_THRESHOLD) {
        reason = 'Similar wording at the same unit';
        strength = 2;
      } else if (categoryId && o.category_id === categoryId && sim >= TEXT_THRESHOLD) {
        reason = 'Similar observation in the same category';
        strength = 1;
      } else if (sim >= 0.65) {
        reason = 'Very similar wording';
        strength = 1;
      }
      if (!reason) return null;
      return {
        ...o,
        photo_count: where('attachments', (a) => a.observation_id === o.id && a.kind === 'photo').length,
        match_reason: reason,
        match_strength: strength,
        similarity: Math.round(sim * 100) / 100,
      };
    })
    .filter(Boolean) as Row[];

  matches.sort(
    (a, b) =>
      b.match_strength - a.match_strength ||
      b.similarity - a.similarity ||
      String(b.observed_at).localeCompare(String(a.observed_at))
  );

  const top = matches.slice(0, limit);
  const times = matches.length + 1;
  const place = [itemLabel, unitLabel].filter(Boolean).join(' - ');
  return {
    count: matches.length,
    window_days: windowDays,
    item_name: itemLabel,
    unit_name: unitLabel,
    matches: top,
    message: top.length
      ? `${place || 'This deficiency'} - repeated deficiency observed ${times} time${times === 1 ? '' : 's'} in the last ${windowDays} days.`
      : null,
  };
}

/* ------------------------------ notifications ----------------------------- */

const render = (template: string, vars: Record<string, unknown>) =>
  String(template ?? '').replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_m, key) =>
    vars[key] == null ? '' : String(vars[key])
  );

const formatDate = (iso?: string | null) => {
  if (!iso) return 'Not specified';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)} ${months[Number(m) - 1] ?? ''} ${y}`;
};

function resolveRecipients(tokens: string[], observation: Row | null, actorId: number | null): number[] {
  const ids = new Set<number>();
  for (const token of tokens) {
    if (token === 'supervisor' && observation?.supervisor_id) {
      const sup = byId('supervisors', observation.supervisor_id);
      if (sup?.user_id) ids.add(sup.user_id);
    } else if (token === 'inspector' && observation?.created_by) {
      ids.add(observation.created_by);
    } else if (token === 'reporting_officer' && observation?.supervisor_id) {
      const sup = byId('supervisors', observation.supervisor_id);
      const officer = byId('supervisors', sup?.reporting_officer_id);
      if (officer?.user_id) ids.add(officer.user_id);
    } else if (token.startsWith('role:')) {
      for (const u of where('users', (user) => user.active && user.role === token.slice(5))) ids.add(u.id);
    } else if (token.startsWith('escalation:')) {
      for (const u of where('users', (user) => user.active && user.role === 'divisional_officer')) ids.add(u.id);
    }
  }
  if (actorId) ids.delete(actorId);
  return [...ids];
}

/** Creates the notification rows and their per-channel delivery records. */
export function dispatch({
  event, observation = null, actorId = null, extraVars = {},
}: {
  event: string; observation?: Row | null; actorId?: number | null;
  extraVars?: Record<string, unknown>;
}) {
  const rule = table('notification_rules').find((r) => r.event === event && r.active);
  if (!rule) return { event, recipients: 0, deliveries: [] as Row[] };
  let tokens: string[] = [];
  try {
    tokens = JSON.parse(rule.recipients);
  } catch {
    tokens = [];
  }
  const userIds = resolveRecipients(tokens, observation, actorId);
  if (!userIds.length) return { event, recipients: 0, deliveries: [] as Row[] };

  const o = observation ?? {};
  const vars = {
    ref_no: o.ref_no ?? '',
    module_name: o.module_name ?? '',
    station_or_train: o.station_name ? `${o.station_name} (${o.station_code})` : o.train_number ?? '',
    unit_name: o.unit_name ?? '',
    item_name: o.item_name ?? '',
    observation: o.observation ?? '',
    severity_name: o.severity_name ?? '',
    department_name: o.department_name ?? '',
    supervisor_name: o.supervisor_name ?? '',
    inspector_name: o.inspector_name ?? '',
    inspection_ref: o.inspection_ref ?? '',
    inspection_type_name: o.inspection_type_name ?? '',
    tdc_text: formatDate(o.tdc),
    photo_count: o.attachment_count ?? 0,
    ...extraVars,
  };

  const deliveries: Row[] = [];
  for (const userId of userIds) {
    const user = byId('users', userId);
    if (!user) continue;
    const notification = insert('notifications', {
      user_id: userId,
      event,
      title: render(rule.template_title ?? 'Observation {{ref_no}}', vars),
      body: render(rule.template_body ?? '', vars),
      observation_id: o.id ?? null,
      inspection_id: o.inspection_id ?? null,
      severity: o.severity_name ?? null,
      link: o.id ? `/observations/${o.id}` : null,
      read_at: null,
      created_at: nowIso(),
    });
    const plan = [
      { channel: 'in_app', enabled: Boolean(rule.in_app), target: String(userId), status: 'sent' },
      { channel: 'email', enabled: Boolean(rule.email), target: user.email, status: 'skipped' },
      { channel: 'sms', enabled: Boolean(rule.sms), target: user.mobile, status: 'skipped' },
    ];
    for (const step of plan) {
      if (!step.enabled) continue;
      const delivery = insert('notification_deliveries', {
        notification_id: notification.id,
        channel: step.channel,
        target: step.target ?? null,
        status: step.status,
        provider: step.channel === 'in_app' ? 'in_app' : 'disabled',
        error: null,
        sent_at: step.status === 'sent' ? nowIso() : null,
        created_at: nowIso(),
      });
      deliveries.push({ channel: delivery.channel, status: delivery.status });
    }
  }
  return { event, recipients: userIds.length, deliveries };
}

/** One step on the observation timeline. */
export function timeline(
  observationId: number,
  { action, from, to, actor, remarks, metadata }: {
    action: string; from?: string | null; to?: string | null;
    actor?: Row | null; remarks?: string | null; metadata?: unknown;
  }
) {
  return insert('observation_events', {
    observation_id: observationId,
    action,
    from_status: from ?? null,
    to_status: to ?? null,
    actor_id: actor?.id ?? null,
    actor_name: actor?.name ?? 'System',
    actor_role: actor?.role ?? 'system',
    remarks: remarks ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_at: nowIso(),
  });
}

export function audit({
  action, entityType, entityId, user, previous, next, remarks,
}: {
  action: string; entityType: string; entityId: number | string | null;
  user?: Row | null; previous?: unknown; next?: unknown; remarks?: string | null;
}) {
  return insert('audit_log', {
    user_id: user?.id ?? null,
    user_name: user?.name ?? 'system',
    role: user?.role ?? 'system',
    action,
    entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null,
    previous_value: previous === undefined ? null : JSON.stringify(previous),
    new_value: next === undefined ? null : JSON.stringify(next),
    remarks: remarks ?? null,
    ip: '127.0.0.1',
    user_agent: 'offline demonstration build',
    created_at: nowIso(),
  });
}

export const observationById = (id: number | string) => {
  const row = byId('observations', id);
  return row ? viewObservation(row) : undefined;
};

/* ------------------------ suggested deficiencies -------------------------- */

/** "{item} not functioning" -> "Water Cooler not functioning". */
export const resolveText = (text: string, itemName?: string | null) =>
  String(text ?? '').replace(/\{item\}/gi, itemName ?? 'the item');

const scopeOf = (row: Row): { scope: string; rank: number } => {
  if (row.item_id != null) return { scope: 'item', rank: 1 };
  if (row.group_id != null) return { scope: 'group', rank: 2 };
  if (row.module_id != null) return { scope: 'module', rank: 3 };
  return { scope: 'generic', rank: 4 };
};

/**
 * The "what usually fails" dropdown for one item: the suggestions mapped to the
 * item, then to its group, then to its module, then the generic ones, followed
 * by the wordings already recorded for it.
 */
export function deficienciesForItem(item: Row, { stationId = null, limit = 40 }: { stationId?: number | null; limit?: number } = {}) {
  const rows = where('item_deficiencies', (d) => {
    if (!d.active) return false;
    if (d.item_id != null) return d.item_id === item.id;
    if (d.group_id != null) return d.group_id === item.group_id;
    if (d.module_id != null) return d.module_id === item.module_id;
    return true;
  });

  const data = rows
    .map((row) => {
      const { scope, rank } = scopeOf(row);
      const department = byId('departments', row.default_department_id);
      const severity = byId('severities', row.default_severity_id);
      const category = byId('observation_categories', row.default_category_id);
      return {
        id: row.id,
        text: resolveText(row.text, item.name),
        template: row.text,
        scope,
        scope_rank: rank,
        department_id: row.default_department_id ?? null,
        department_name: department?.name ?? null,
        department_code: department?.code ?? null,
        severity_id: row.default_severity_id ?? null,
        severity_name: severity?.name ?? null,
        category_id: row.default_category_id ?? null,
        category_name: category?.name ?? null,
        suggested_tdc_days: row.suggested_tdc_days ?? null,
        times_used: where('observations', (o) => o.deficiency_id === row.id).length,
        sort_order: row.sort_order ?? 100,
      };
    })
    .sort(
      (a, b) =>
        a.scope_rank - b.scope_rank
        || b.times_used - a.times_used
        || a.sort_order - b.sort_order
        || a.text.localeCompare(b.text)
    )
    .slice(0, limit);

  // Wordings seen more than once for this item, most used first.
  const seen = new Map<string, { text: string; times_used: number; last_used: string }>();
  for (const o of where('observations', (row) => row.item_id === item.id && (!stationId || row.station_id === stationId))) {
    const key = String(o.observation ?? '').trim().toLowerCase();
    if (!key) continue;
    const entry = seen.get(key);
    if (entry) {
      entry.times_used += 1;
      if (String(o.observed_at) > entry.last_used) entry.last_used = String(o.observed_at);
    } else {
      seen.set(key, { text: o.observation, times_used: 1, last_used: String(o.observed_at) });
    }
  }

  return {
    item: { id: item.id, name: item.name, group_id: item.group_id, module_id: item.module_id },
    data,
    previously_used: [...seen.values()]
      .filter((entry) => entry.times_used > 1)
      .sort((a, b) => b.times_used - a.times_used || b.last_used.localeCompare(a.last_used))
      .slice(0, 5),
  };
}

/** Accepts a deficiency id only for an item it actually belongs to. */
export function deficiencyFor(deficiencyId: number | null | undefined, item: Row | undefined): Row | null {
  if (!deficiencyId) return null;
  const row = byId('item_deficiencies', deficiencyId);
  if (!row?.active) return null;
  const belongs =
    (row.item_id == null && row.group_id == null && row.module_id == null)
    || (row.item_id != null && item && row.item_id === item.id)
    || (row.item_id == null && row.group_id != null && item && row.group_id === item.group_id)
    || (row.item_id == null && row.group_id == null && row.module_id != null && item && row.module_id === item.module_id);
  return belongs ? row : null;
}

/* ---------------------------- inspection notes ---------------------------- */

const setting = (key: string, fallback = '') =>
  table('settings').find((row) => row.key === key)?.value ?? fallback;

/** The office block, signature and standing wording, all editable in Admin. */
export function letterDefaults() {
  return {
    letterhead: setting('note.letterhead', 'SOUTH EAST CENTRAL RAILWAY\nBilaspur Division'),
    office: setting('note.office', 'Sr. Divisional Commercial Manager, Bilaspur'),
    number_prefix: setting('note.number_prefix', 'BSP/COM/INSP'),
    addressee: setting('note.addressee', 'The Concerned Supervisors / Departmental Officers'),
    salutation: setting('note.salutation', 'Sir / Madam,'),
    preamble: setting('note.preamble', 'The following deficiencies were noticed during the inspection referred to above.'),
    closing: setting('note.closing', 'Compliance may please be advised through the inspection management system.'),
    copy_to: setting('note.copy_to', 'Sr. DCM / DCM / concerned Branch Officers.'),
  };
}

/** BSP/COM/INSP/2026-27/014 - a running serial within the financial year. */
export function nextNoteNo(prefix = letterDefaults().number_prefix, date = todayIso()): string {
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  const like = `${prefix}/${fy}/`;
  const last = table('inspection_notes')
    .map((row) => String(row.note_no ?? ''))
    .filter((ref) => ref.startsWith(like))
    .map((ref) => Number.parseInt(ref.split('/').pop() ?? '0', 10))
    .reduce((max, n) => Math.max(max, Number.isFinite(n) ? n : 0), 0);
  return `${like}${String(last + 1).padStart(3, '0')}`;
}

/** The fields of an observation that a note prints. */
export function noteObservation(o: Row, slNo: number, remarks: string | null = null): Row {
  const view = viewObservation(o);
  return {
    sl_no: slNo,
    remarks,
    id: view.id,
    ref_no: view.ref_no,
    station_id: view.station_id,
    station_name: view.station_name,
    station_code: view.station_code,
    train_id: view.train_id,
    train_number: view.train_number,
    train_name: view.train_name,
    module_id: view.module_id,
    module_code: view.module_code,
    module_name: view.module_name,
    unit_name: view.unit_name,
    coach: view.coach,
    item_name: view.item_name,
    observation: view.observation,
    tdc: view.tdc,
    days_to_tdc: view.days_to_tdc,
    status: view.status,
    severity_name: view.severity_name,
    department_name: view.department_name,
    department_code: view.department_code,
    supervisor_name: view.supervisor_name,
    supervisor_designation: view.supervisor_designation,
    supervisor_mobile: view.supervisor_mobile,
    observed_at: view.observed_at,
    is_overdue: view.is_overdue,
    repeat_count: view.repeat_count,
    attachment_count: view.attachment_count,
    inspection_id: view.inspection_id,
  };
}

/** A note with its observations read live, so their current status shows. */
export function noteById(id: number | string): Row | undefined {
  const note = byId('inspection_notes', id);
  if (!note) return undefined;
  const module = byId('modules', note.module_id);
  const station = byId('stations', note.station_id);
  const train = byId('trains', note.train_id);
  const inspection = byId('inspections', note.inspection_id);
  const type = inspection ? byId('inspection_types', inspection.inspection_type_id) : undefined;
  const author = byId('users', note.created_by);
  const links = where('inspection_note_observations', (row) => row.note_id === note.id)
    .slice()
    .sort((a, b) => a.sl_no - b.sl_no);
  return {
    ...note,
    module_code: module?.code ?? null,
    module_name: module?.name ?? null,
    station_name: station?.name ?? null,
    station_code: station?.code ?? null,
    train_number: train?.number ?? null,
    inspection_ref: inspection?.ref_no ?? null,
    inspection_type_name: type?.name ?? null,
    created_by_name: author?.name ?? 'Unknown',
    created_by_designation: author?.designation ?? null,
    observations: links
      .map((link) => {
        const observation = byId('observations', link.observation_id);
        return observation ? noteObservation(observation, link.sl_no, link.remarks) : null;
      })
      .filter(Boolean) as Row[],
  };
}

/** Groups a note's observations by the department that has to act. */
export function byDepartment(observations: Row[]) {
  const groups = new Map<string, Row>();
  for (const o of observations) {
    const key = o.department_name ?? 'Not assigned';
    if (!groups.has(key)) groups.set(key, { department: key, code: o.department_code ?? null, observations: [] });
    groups.get(key)!.observations.push(o);
  }
  return [...groups.values()].sort((a, b) => String(a.department).localeCompare(String(b.department)));
}
