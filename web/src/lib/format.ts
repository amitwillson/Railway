import type { ObservationStatus } from '../api/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-09-30 -> "30 Sep 2026" */
export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const iso = String(value).slice(0, 10);
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return String(value);
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(date.toISOString())}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function relativeTime(value?: string | null): string {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(months / 12)} yr ago`;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<ObservationStatus, string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  acknowledged: 'Acknowledged',
  in_progress: 'Action in progress',
  compliance_submitted: 'Compliance submitted',
  verified: 'Verified',
  closed: 'Closed',
  rejected: 'Rejected',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

/** Badge tone for a workflow status. Every badge also shows its label. */
export function statusTone(status: ObservationStatus): string {
  switch (status) {
    case 'closed':
    case 'verified':
      return 'good';
    case 'compliance_submitted':
      return 'info';
    case 'rejected':
    case 'reopened':
      return 'serious';
    case 'cancelled':
      return 'neutral';
    case 'acknowledged':
    case 'in_progress':
      return 'accent';
    default:
      return 'warning';
  }
}

/** Severity tone uses the reserved status roles; the name is always shown. */
export function severityTone(name?: string | null): string {
  switch ((name ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'major':
      return 'serious';
    case 'moderate':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function moduleTone(accent?: string | null): string {
  if (accent === 'green') return 'green';
  if (accent === 'amber') return 'amber';
  return 'blue';
}

/** The seven-step workflow shown as a progress strip. */
export const WORKFLOW: ObservationStatus[] = [
  'submitted', 'assigned', 'acknowledged', 'in_progress',
  'compliance_submitted', 'verified', 'closed',
];

export function workflowPosition(status: ObservationStatus): number {
  if (status === 'closed') return WORKFLOW.length - 1;
  if (status === 'rejected' || status === 'reopened') return 1;
  if (status === 'cancelled') return -1;
  const index = WORKFLOW.indexOf(status);
  return index < 0 ? 0 : index;
}

export function compact(n: number | null | undefined): string {
  const value = n ?? 0;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(0)}K`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

export const number = (n: number | null | undefined) => (n ?? 0).toLocaleString();

/** "3 days overdue" / "due in 2 days" / "due today" */
export function tdcText(tdc: string | null, daysToTdc: number | null, isOverdue: boolean): string {
  if (!tdc) return 'No TDC';
  if (isOverdue) {
    const days = Math.abs(daysToTdc ?? 0);
    return `${days} day${days === 1 ? '' : 's'} overdue`;
  }
  if (daysToTdc === 0) return 'Due today';
  if (daysToTdc != null && daysToTdc > 0) return `Due in ${daysToTdc} day${daysToTdc === 1 ? '' : 's'}`;
  return formatDate(tdc);
}

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const bytes = (n?: number | null) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
