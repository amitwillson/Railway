import cron from 'node-cron';
import config from '../config.js';
import { all, get, getDb, insert, today, update, nowIso } from '../db/index.js';
import { dispatch, resolveRecipients } from './notify.js';
import { auditSystem } from './audit.js';

const OPEN_STATUSES = ['submitted', 'assigned', 'acknowledged', 'in_progress', 'rejected', 'reopened'];

/** Returns the TDC rule for a severity, falling back to the default rule. */
export function tdcRuleFor(severityId) {
  return (
    get('SELECT * FROM tdc_rules WHERE active = 1 AND severity_id = ?', [severityId]) ??
    get('SELECT * FROM tdc_rules WHERE active = 1 AND severity_id IS NULL ORDER BY id LIMIT 1') ?? {
      remind_before_days: 2,
      remind_on_due_date: 1,
      overdue_repeat_days: 3,
      escalate_after_days: 7,
      escalate_to_role: 'divisional_officer',
    }
  );
}

function alreadySent(observationId, kind, level, forDate) {
  return !!get(
    'SELECT 1 FROM reminder_log WHERE observation_id = ? AND kind = ? AND level = ? AND for_date = ?',
    [observationId, kind, level, forDate]
  );
}

function markSent(observationId, kind, level, forDate) {
  try {
    insert('reminder_log', {
      observation_id: observationId,
      kind,
      level,
      for_date: forDate,
    });
    return true;
  } catch {
    return false; // UNIQUE guard - another worker already sent it
  }
}

const dayDiff = (fromDate, toDate) =>
  Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);

/**
 * TDC monitoring sweep: pre-due reminders, due-date reminders, overdue
 * reminders and time-based escalation. Idempotent per day thanks to
 * reminder_log, so it is safe to run it more than once.
 */
export async function runReminderSweep({ asOf = today(), dryRun = false } = {}) {
  const placeholders = OPEN_STATUSES.map(() => '?').join(',');
  const observations = all(
    `SELECT * FROM v_observations
      WHERE tdc IS NOT NULL AND status IN (${placeholders})
      ORDER BY tdc ASC`,
    OPEN_STATUSES
  );
  const levels = all('SELECT * FROM escalation_levels WHERE active = 1 ORDER BY after_days DESC');
  const summary = { as_of: asOf, scanned: observations.length, before_due: 0, on_due: 0, overdue: 0, escalated: 0 };

  for (const obs of observations) {
    const rule = tdcRuleFor(obs.severity_id);
    const tdcDate = String(obs.tdc).slice(0, 10);
    const diff = dayDiff(asOf, tdcDate); // > 0 upcoming, 0 due today, < 0 overdue

    if (diff > 0 && diff === rule.remind_before_days) {
      if (await send(obs, 'TDC_REMINDER', 'before_due', 0, asOf, { days_remaining: diff }, dryRun)) {
        summary.before_due += 1;
      }
    } else if (diff === 0 && rule.remind_on_due_date) {
      if (await send(obs, 'TDC_DUE_TODAY', 'on_due', 0, asOf, { days_remaining: 0 }, dryRun)) {
        summary.on_due += 1;
      }
    } else if (diff < 0) {
      const overdueBy = Math.abs(diff);
      const every = Math.max(1, rule.overdue_repeat_days);
      if (overdueBy === 1 || overdueBy % every === 0) {
        if (await send(obs, 'OBSERVATION_OVERDUE', 'overdue', 0, asOf, { overdue_days: overdueBy }, dryRun)) {
          summary.overdue += 1;
        }
      }
      const due = levels.find((l) => overdueBy >= l.after_days);
      if (due && obs.escalation_level < due.level && overdueBy >= rule.escalate_after_days) {
        const ok = await send(
          obs,
          'OBSERVATION_ESCALATED',
          'escalation',
          due.level,
          asOf,
          { overdue_days: overdueBy, escalation_level: due.level, escalation_name: due.name },
          dryRun,
          [`escalation:${due.level}`]
        );
        if (ok && !dryRun) {
          update('observations', obs.id, { escalation_level: due.level, updated_at: nowIso() });
          insert('observation_events', {
            observation_id: obs.id,
            action: 'ESCALATED',
            from_status: obs.status,
            to_status: obs.status,
            actor_name: 'System (TDC monitor)',
            actor_role: 'system',
            remarks: `Escalated to ${due.name} - overdue by ${overdueBy} day(s)`,
            metadata: JSON.stringify({ level: due.level, overdue_days: overdueBy }),
          });
          auditSystem({
            action: 'OBSERVATION_ESCALATED',
            entityType: 'observation',
            entityId: obs.id,
            next: { escalation_level: due.level, overdue_days: overdueBy },
            remarks: `Automatic escalation to ${due.target_role}`,
          });
          summary.escalated += 1;
        }
      }
    }
  }
  return summary;
}

async function send(obs, event, kind, level, forDate, extraVars, dryRun, recipientTokensOverride) {
  if (alreadySent(obs.id, kind, level, forDate)) return false;
  if (dryRun) return true;
  if (!markSent(obs.id, kind, level, forDate)) return false;
  await dispatch({
    event,
    observation: obs,
    extraVars,
    ...(recipientTokensOverride
      ? { recipientsOverride: resolveTokens(recipientTokensOverride, obs) }
      : {}),
  });
  return true;
}

/** Escalation notices always also inform the supervisor and the inspector. */
function resolveTokens(tokens, observation) {
  return resolveRecipients([...tokens, 'supervisor', 'inspector'], { observation });
}

let task;

/** Registers the daily sweep. Returns the scheduled task (or null if disabled). */
export function startScheduler() {
  if (!config.scheduler.enabled) {
    console.info('[scheduler] disabled by configuration');
    return null;
  }
  if (!cron.validate(config.scheduler.cron)) {
    console.error(`[scheduler] invalid cron expression "${config.scheduler.cron}" - not scheduled`);
    return null;
  }
  task = cron.schedule(
    config.scheduler.cron,
    async () => {
      try {
        const summary = await runReminderSweep();
        console.info('[scheduler] TDC sweep', JSON.stringify(summary));
      } catch (err) {
        console.error('[scheduler] sweep failed:', err.message);
      }
    },
    { timezone: config.scheduler.timezone }
  );
  console.info(
    `[scheduler] TDC sweep scheduled "${config.scheduler.cron}" (${config.scheduler.timezone})`
  );
  return task;
}

export function stopScheduler() {
  task?.stop();
  task = undefined;
}

/** Keeps WAL from growing without bound in long-running deployments. */
export function checkpoint() {
  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* non-fatal */
  }
}
