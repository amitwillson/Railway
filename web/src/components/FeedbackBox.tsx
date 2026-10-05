import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useToast } from '../state/ToastContext';
import Icon from './Icon';
import { Badge, Banner, Button, Card, Field } from './ui';
import type { Feedback, FeedbackKind } from '../api/types';

/**
 * What would make this application easier to use.
 *
 * It is asked at the end of an inspection because that is the moment an inspector
 * knows what slowed them down; a week later they do not. The same box sits on the
 * profile screen so that a supervisor who never runs an inspection can still
 * answer it.
 *
 * It is deliberately optional and out of the way of finishing the inspection: an
 * officer who wants to close the job and go should not have to dismiss anything.
 */

const KINDS: { value: FeedbackKind; label: string; icon: 'edit' | 'alert' | 'check' }[] = [
  { value: 'suggestion', label: 'A suggestion', icon: 'edit' },
  { value: 'problem', label: 'Something got in the way', icon: 'alert' },
  { value: 'praise', label: 'Something that works well', icon: 'check' },
];

/** Where in the application it is about, so the office can group what comes in. */
const AREAS = [
  'Inspection sheet',
  'Recording a deficiency',
  'Suggested deficiencies',
  'The report',
  'Compliance',
  'Notifications',
  'Dashboards and reports',
  'Offline working',
  'Signing in',
  'Something else',
];

export default function FeedbackBox({
  inspectionId, compact, onSubmitted,
}: {
  /** Ties the suggestion to the inspection it came out of. */
  inspectionId?: number;
  /** Inside the finish sheet, where space is short. */
  compact?: boolean;
  onSubmitted?: (feedback: Feedback) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(!compact);
  const [kind, setKind] = useState<FeedbackKind>('suggestion');
  const [area, setArea] = useState<string>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (text.trim().length < 5) {
      setError('Say a little more about what would help');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<Feedback>('/profile/feedback', {
        suggestion: text.trim(),
        kind,
        area: area || undefined,
        inspection_id: inspectionId,
      });
      setSent(true);
      setText('');
      setArea('');
      toast.success('Thank you - it has gone to the divisional office');
      onSubmitted?.(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send it');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Banner tone="good" icon="check">
        <div>
          <strong>Sent to the divisional office.</strong> You can see what came of it under Profile &rarr;
          Improving this application.
        </div>
        <Button size="sm" variant="quiet" style={{ marginTop: 8 }} onClick={() => setSent(false)}>
          Say something else
        </Button>
      </Banner>
    );
  }

  const form = (
    <>
      <div className="chips" style={{ marginBottom: 12 }} role="radiogroup" aria-label="What kind of feedback">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={kind === k.value}
            className={`chip${kind === k.value ? ' chip--on' : ''}`}
            onClick={() => setKind(k.value)}
          >
            <Icon name={k.icon} size={13} /> {k.label}
          </button>
        ))}
      </div>

      <Field label="Which part of the app" hint="Optional - it helps the office group what comes in">
        <div className="chips">
          {AREAS.map((a) => (
            <button
              key={a}
              type="button"
              className={`chip chip--xs${area === a ? ' chip--on' : ''}`}
              onClick={() => setArea(area === a ? '' : a)}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>

      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          kind === 'problem'
            ? 'What got in the way, and where?'
            : kind === 'praise'
              ? 'What works well and should stay as it is?'
              : 'What would make this quicker or easier next time?'
        }
        aria-label="Your suggestion"
        style={{ minHeight: 96 }}
      />

      {error && <div style={{ marginTop: 10 }}><Banner tone="danger">{error}</Banner></div>}

      <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
        <Button icon="send" loading={busy} onClick={submit} disabled={text.trim().length < 5}>
          Send to the office
        </Button>
        {compact && (
          <Button variant="quiet" onClick={() => setOpen(false)}>Not now</Button>
        )}
        <span className="xsmall muted" style={{ alignSelf: 'center' }}>
          It goes with your name, so the office can come back to you.
        </span>
      </div>
    </>
  );

  if (compact) {
    return open ? (
      <div style={{ marginTop: 14 }}>
        <div className="section-label">Anything that would make this easier?</div>
        {form}
      </div>
    ) : (
      <Button variant="quiet" icon="edit" block style={{ marginTop: 14 }} onClick={() => setOpen(true)}>
        Suggest an improvement to this app
      </Button>
    );
  }

  return (
    <Card
      title="Improving this application"
      subtitle="You use it every day. Say what would make it quicker."
      icon="edit"
    >
      {form}
    </Card>
  );
}

/** What this officer has said, and what the office said back. */
export function MyFeedback({ data }: { data: Feedback[] }) {
  if (data.length === 0) {
    return <p className="small muted" style={{ margin: 0 }}>You have not said anything yet.</p>;
  }
  const tone: Record<string, string> = {
    new: 'outline', noted: 'accent', planned: 'warning', done: 'good', declined: 'neutral',
  };
  const label: Record<string, string> = {
    new: 'Sent', noted: 'Read', planned: 'Planned', done: 'Done', declined: 'Not taken up',
  };
  return (
    <div>
      {data.map((f) => (
        <div className="sheet-row" key={f.id}>
          <div className="row row--wrap" style={{ gap: 6 }}>
            <Badge tone={tone[f.status] ?? 'outline'}>{label[f.status] ?? f.status}</Badge>
            {f.area && <Badge tone="outline">{f.area}</Badge>}
            {f.inspection_ref && <span className="xsmall muted">{f.inspection_ref}</span>}
          </div>
          <div className="small" style={{ marginTop: 4 }}>{f.suggestion}</div>
          {f.response && (
            <div className="xsmall" style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--accent)' }}>
              <strong>{f.responded_by_name ?? 'The office'}:</strong> {f.response}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
