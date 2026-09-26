import config from '../config.js';
import { all, get, insert, nowIso, update } from '../db/index.js';
import { escalationTargets } from './assignment.js';

/* -------------------------------------------------------------------------- */
/* Channel adapters                                                           */
/*                                                                            */
/* The in-app channel is always live. Email and SMS are pluggable: when a      */
/* gateway URL is configured the payload is POSTed to it; when the channel is  */
/* enabled without a gateway the message is written to the server log and      */
/* recorded as sent by the `log` provider, so delivery status stays honest in  */
/* every deployment.                                                          */
/* -------------------------------------------------------------------------- */

async function sendEmail({ to, subject, body }) {
  if (!config.notifications.emailEnabled) return { status: 'skipped', provider: 'disabled' };
  if (!to) return { status: 'skipped', provider: 'no-address' };
  if (!config.notifications.smtpUrl) {
    console.info(`[email:log] to=${to} subject=${subject}`);
    return { status: 'sent', provider: 'log' };
  }
  try {
    const res = await fetch(config.notifications.smtpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.notifications.fromEmail, to, subject, text: body }),
    });
    if (!res.ok) return { status: 'failed', provider: 'http', error: `HTTP ${res.status}` };
    return { status: 'sent', provider: 'http' };
  } catch (err) {
    return { status: 'failed', provider: 'http', error: err.message };
  }
}

async function sendSms({ to, body }) {
  if (!config.notifications.smsEnabled) return { status: 'skipped', provider: 'disabled' };
  if (!to) return { status: 'skipped', provider: 'no-mobile' };
  if (!config.notifications.smsGatewayUrl) {
    console.info(`[sms:log] to=${to} body=${body.slice(0, 120)}`);
    return { status: 'sent', provider: 'log' };
  }
  try {
    const res = await fetch(config.notifications.smsGatewayUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, message: body }),
    });
    if (!res.ok) return { status: 'failed', provider: 'http', error: `HTTP ${res.status}` };
    return { status: 'sent', provider: 'http' };
  } catch (err) {
    return { status: 'failed', provider: 'http', error: err.message };
  }
}

/* -------------------------------------------------------------------------- */
/* Templating                                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULTS = {
  title: 'Inspection observation {{ref_no}}',
  body:
    '{{module_name}} | {{station_or_train}} | {{unit_name}} | {{item_name}}\n' +
    'Observation: {{observation}}\n' +
    'Severity: {{severity_name}} | Action by: {{department_name}} | TDC: {{tdc_text}}\n' +
    'Inspecting officer: {{inspector_name}}',
};

function renderTemplate(template, vars) {
  return String(template ?? '').replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_m, key) =>
    vars[key] == null ? '' : String(vars[key])
  );
}

function templateVars(observation, extra = {}) {
  const o = observation ?? {};
  return {
    ref_no: o.ref_no ?? '',
    module_name: o.module_name ?? '',
    module_code: o.module_code ?? '',
    station_name: o.station_name ?? '',
    station_code: o.station_code ?? '',
    train_number: o.train_number ?? '',
    train_name: o.train_name ?? '',
    station_or_train: o.station_name
      ? `${o.station_name} (${o.station_code ?? ''})`
      : [o.train_number, o.train_name].filter(Boolean).join(' '),
    unit_name: o.unit_name ?? '',
    item_name: o.item_name ?? '',
    observation: o.observation ?? '',
    severity_name: o.severity_name ?? '',
    category_name: o.category_name ?? '',
    department_name: o.department_name ?? '',
    supervisor_name: o.supervisor_name ?? '',
    inspector_name: o.inspector_name ?? '',
    inspection_ref: o.inspection_ref ?? '',
    inspection_type_name: o.inspection_type_name ?? '',
    tdc: o.tdc ?? '',
    tdc_text: o.tdc ? formatDate(o.tdc) : 'Not specified',
    photo_count: o.attachment_count ?? 0,
    status: o.status ?? '',
    ...extra,
  };
}

function formatDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[Number(m) - 1] ?? ''} ${y}`;
}

/* -------------------------------------------------------------------------- */
/* Recipient resolution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Recipient tokens understood by notification_rules.recipients:
 *   supervisor        - the user account linked to the assigned supervisor
 *   inspector         - the officer who raised the observation
 *   reporting_officer - the assigned supervisor's reporting officer
 *   role:<role>       - every active user holding that role
 *   escalation:<n>    - the escalation chain for level n
 */
export function resolveRecipients(tokens, { observation, actorId } = {}) {
  const ids = new Set();
  for (const token of tokens) {
    if (token === 'supervisor' && observation?.supervisor_id) {
      const sup = get('SELECT user_id FROM supervisors WHERE id = ?', [observation.supervisor_id]);
      if (sup?.user_id) ids.add(sup.user_id);
    } else if (token === 'inspector' && observation?.created_by) {
      ids.add(observation.created_by);
    } else if (token === 'reporting_officer' && observation?.supervisor_id) {
      const sup = get('SELECT reporting_officer_id FROM supervisors WHERE id = ?', [
        observation.supervisor_id,
      ]);
      const ro = sup?.reporting_officer_id
        ? get('SELECT user_id FROM supervisors WHERE id = ?', [sup.reporting_officer_id])
        : null;
      if (ro?.user_id) ids.add(ro.user_id);
    } else if (token.startsWith('role:')) {
      const role = token.slice(5);
      for (const u of all('SELECT id FROM users WHERE active = 1 AND role = ?', [role])) {
        ids.add(u.id);
      }
    } else if (token.startsWith('escalation:')) {
      const level = Number.parseInt(token.slice(11), 10) || 1;
      for (const id of escalationTargets(observation ?? {}, level)) ids.add(id);
    }
  }
  // Never notify people about their own action.
  if (actorId) ids.delete(actorId);
  return [...ids];
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Creates notification rows for an event and pushes them out on every channel
 * the admin has enabled for that event. Returns a delivery summary.
 *
 * Nothing here throws: a notification failure must never roll back the
 * observation that triggered it. Failures are recorded on the delivery row.
 */
export async function dispatch({
  event,
  observation = null,
  inspection = null,
  actorId = null,
  extraVars = {},
  recipientsOverride = null,
  link = null,
}) {
  const rule = get('SELECT * FROM notification_rules WHERE event = ? AND active = 1', [event]);
  if (!rule && !recipientsOverride) return { event, recipients: 0, deliveries: [] };

  let tokens = [];
  try {
    tokens = rule ? JSON.parse(rule.recipients) : [];
  } catch {
    tokens = [];
  }
  const userIds = recipientsOverride ?? resolveRecipients(tokens, { observation, actorId });
  if (userIds.length === 0) return { event, recipients: 0, deliveries: [] };

  const vars = templateVars(observation, extraVars);
  const title = renderTemplate(rule?.template_title || DEFAULTS.title, vars);
  const bodyText = renderTemplate(rule?.template_body || DEFAULTS.body, vars);
  const deliveries = [];

  for (const userId of userIds) {
    const user = get('SELECT id, name, email, mobile FROM users WHERE id = ?', [userId]);
    if (!user) continue;
    const notificationId = insert('notifications', {
      user_id: userId,
      event,
      title,
      body: bodyText,
      observation_id: observation?.id ?? null,
      inspection_id: inspection?.id ?? observation?.inspection_id ?? null,
      severity: observation?.severity_name ?? null,
      link: link ?? (observation ? `/observations/${observation.id}` : null),
    });

    const plan = [
      { channel: 'in_app', enabled: rule ? !!rule.in_app : true, target: String(userId) },
      { channel: 'email', enabled: rule ? !!rule.email : true, target: user.email },
      { channel: 'sms', enabled: rule ? !!rule.sms : false, target: user.mobile },
    ];

    for (const step of plan) {
      if (!step.enabled) continue;
      const deliveryId = insert('notification_deliveries', {
        notification_id: notificationId,
        channel: step.channel,
        target: step.target ?? null,
        status: 'queued',
      });
      let result = { status: 'sent', provider: 'in_app' };
      if (step.channel === 'email') {
        result = await sendEmail({ to: step.target, subject: title, body: bodyText });
      } else if (step.channel === 'sms') {
        result = await sendSms({ to: step.target, body: `${title}\n${bodyText}` });
      }
      update('notification_deliveries', deliveryId, {
        status: result.status,
        provider: result.provider ?? null,
        error: result.error ?? null,
        sent_at: result.status === 'sent' ? nowIso() : null,
      });
      deliveries.push({ userId, channel: step.channel, ...result });
    }
  }

  return { event, recipients: userIds.length, deliveries };
}
