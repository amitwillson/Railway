/**
 * Browser ports of the three server-side engines the demonstration needs to
 * behave truthfully: smart assignment, repeated-deficiency detection and the
 * notification dispatcher. They follow the same rules as the server so the
 * offline build shows the real behaviour rather than a mock-up.
 */
import {
  byId, insert, nowIso, observations, table, viewObservation, where, type Row,
} from './store';

/* ------------------------------ assignment -------------------------------- */

const matchesArea = (area: string | null, unitName: string | null) => {
  if (!area || !unitName) return false;
  const a = area.toLowerCase();
  const u = unitName.toLowerCase();
  if (a.includes(u) || u.includes(a)) return true;
  return u.split(/[^a-z0-9]+/).filter((w) => w.length > 3).some((w) => a.includes(w));
};

export function findSupervisors({
  stationId, unitId, departmentId, itemId, limit = 25,
}: {
  stationId?: number | null; unitId?: number | null;
  departmentId?: number | null; itemId?: number | null; limit?: number;
}): Row[] {
  if (!departmentId) return [];
  const unit = byId('units', unitId);
  const item = byId('inspection_items', itemId);
  const candidates = where('supervisors', (s) => s.active && s.department_id === departmentId);
  const coverage = where('supervisor_coverage', (c) => c.active);

  const scored: Row[] = candidates.map((sup) => {
    const station = byId('stations', sup.station_id);
    const department = byId('departments', sup.department_id);
    const reportingOfficer = byId('supervisors', sup.reporting_officer_id);
    let score = 70;
    let reason = `Active ${department?.name ?? ''} supervisor`;

    if (sup.is_default_for_department) {
      score = 60;
      reason = `Nominated ${department?.name ?? ''} supervisor`;
    }
    if (stationId && sup.station_id === stationId) {
      score = 50;
      reason = `Posted at ${station?.name} (${department?.name})`;
      if (unit && matchesArea(sup.area_of_responsibility, unit.name)) {
        score = 40;
        reason = `Responsible for ${unit.name} at ${station?.name}`;
      }
    }
    for (const c of coverage.filter((row) => row.supervisor_id === sup.id)) {
      const sameStation = c.station_id != null && c.station_id === stationId;
      const globalStation = c.station_id == null;
      if (!sameStation && !globalStation) continue;
      if (unit && c.unit_id && c.unit_id === unit.id) {
        score = Math.min(score, 10 + c.priority / 1000);
        reason = `Mapped to ${unit.name}${station?.name ? ` at ${station.name}` : ''}`;
      } else if (unit && c.unit_kind && unit.kind && c.unit_kind === unit.kind) {
        score = Math.min(score, 20 + c.priority / 1000);
        reason = `Mapped to all ${c.unit_kind} areas`;
      } else if (item && c.item_group_id && item.group_id === c.item_group_id) {
        score = Math.min(score, 25 + c.priority / 1000);
        reason = 'Mapped to this inspection category';
      } else if (sameStation && !c.unit_id && !c.unit_kind && !c.item_group_id) {
        score = Math.min(score, 30 + c.priority / 1000);
        reason = `Mapped to ${station?.name ?? 'this station'}`;
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
      match_score: score,
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
