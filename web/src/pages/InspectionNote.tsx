import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, reportUrl } from '../api/client';
import { IS_DEMO } from '../api/transport';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import Icon from '../components/Icon';
import { Badge, Banner, Button, Card, EmptyState, Field, Loading } from '../components/ui';
import { formatDate, formatDateTime, titleCase } from '../lib/format';
import type { InspectionNote, NoteDraft, NoteObservation, NoteSummary } from '../api/types';

/* -------------------------------------------------------------------------- */
/* The letter itself                                                          */
/* -------------------------------------------------------------------------- */

/** How a date is written in a letter: 30 September 2026. */
const letterDate = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

const shortDate = (iso: string | null) => {
  if (!iso) return 'Not fixed';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
};

interface LetterFields {
  note_no: string;
  letter_date: string;
  subject: string;
  addressee: string | null;
  salutation: string | null;
  preamble: string | null;
  closing: string | null;
  copy_to: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  office: string | null;
  letterhead: string | null;
  inspection_ref?: string | null;
}

/**
 * The note as it goes out: letterhead, number and date, subject, the
 * observations tabulated, signature and copy-to. The same markup is what the
 * browser prints, so what is on screen is what is on paper.
 */
function Letter({
  fields, observations, groupByDepartment, showStatus,
}: {
  fields: LetterFields;
  observations: NoteObservation[];
  groupByDepartment: boolean;
  showStatus?: boolean;
}) {
  const groups = useMemo(() => {
    if (!groupByDepartment) return [{ department: null as string | null, observations }];
    const map = new Map<string, NoteObservation[]>();
    for (const o of observations) {
      const key = o.department_name ?? 'Not assigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([department, rows]) => ({ department, observations: rows }));
  }, [observations, groupByDepartment]);

  return (
    <article className="letter" id="letter">
      <header className="letter__head">
        {(fields.letterhead ?? '').split('\n').filter(Boolean).map((line, index) => (
          <div key={line} className={index === 0 ? 'letter__org' : 'letter__office'}>{line}</div>
        ))}
      </header>

      <div className="letter__meta">
        <span>No. {fields.note_no}</span>
        <span>Date: {letterDate(fields.letter_date)}</span>
      </div>

      {fields.addressee && (
        <div className="letter__to">
          <div>To,</div>
          <div className="letter__to-name">{fields.addressee}</div>
        </div>
      )}

      <p className="letter__subject"><strong>Sub:</strong> {fields.subject}</p>
      {fields.inspection_ref && <p className="letter__ref">Ref: Inspection {fields.inspection_ref}</p>}

      {fields.salutation && <p className="letter__salutation">{fields.salutation}</p>}
      {fields.preamble && <p className="letter__body">{fields.preamble}</p>}

      {groups.map((group) => (
        <div key={group.department ?? 'all'} className="letter__group">
          {group.department && <div className="letter__group-head">{group.department}</div>}
          <table className="letter__table">
            <thead>
              <tr>
                <th style={{ width: '4%' }}>Sl.</th>
                <th style={{ width: '15%' }}>Location / Unit</th>
                <th style={{ width: '13%' }}>Item</th>
                <th>Deficiency noticed</th>
                <th style={{ width: '11%' }}>Action by</th>
                <th style={{ width: '13%' }}>Supervisor</th>
                <th style={{ width: '9%' }}>TDC</th>
                {showStatus && <th style={{ width: '10%' }}>Status</th>}
              </tr>
            </thead>
            <tbody>
              {group.observations.map((o) => (
                <tr key={o.id}>
                  <td className="center">{o.sl_no}</td>
                  <td>{[o.unit_name, o.coach && `Coach ${o.coach}`].filter(Boolean).join(' - ') || '-'}</td>
                  <td>{o.item_name ?? '-'}</td>
                  <td>{o.observation}</td>
                  <td>{o.department_name}</td>
                  <td>{o.supervisor_name ?? 'Not mapped'}</td>
                  <td className="center">{shortDate(o.tdc)}</td>
                  {showStatus && (
                    <td className="center">
                      {titleCase(o.status)}
                      {o.is_overdue && <div className="letter__overdue">overdue</div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {fields.closing && <p className="letter__body">{fields.closing}</p>}

      <div className="letter__signature">
        <div className="letter__sign-name">{fields.signatory_name}</div>
        {fields.signatory_designation && <div>{fields.signatory_designation}</div>}
        {fields.office && <div>{fields.office}</div>}
      </div>

      {fields.copy_to && (
        <div className="letter__copy">
          <strong>Copy to:</strong> {fields.copy_to}
        </div>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Compose                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compiles the observations of an inspection - or any observations picked from
 * the observation list - into one numbered letter. The wording comes from the
 * office defaults and stays editable until the note is issued.
 */
export function NoteCompose() {
  const { id: inspectionId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const observationIds = params.get('observations');
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [grouped, setGrouped] = useState(true);
  const [fields, setFields] = useState<LetterFields | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<NoteDraft>('/notes/draft', {
      inspection_id: inspectionId ?? undefined,
      observation_ids: observationIds ?? undefined,
    })
      .then((d) => {
        setDraft(d);
        setInclude(new Set(d.observations.map((o) => o.id)));
        setFields({
          note_no: d.note_no,
          letter_date: d.letter_date,
          subject: d.subject,
          addressee: d.addressee,
          salutation: d.salutation,
          preamble: d.preamble,
          closing: d.closing,
          copy_to: d.copy_to,
          signatory_name: user?.name ?? null,
          signatory_designation: user?.designation ?? null,
          office: d.office,
          letterhead: d.letterhead,
          inspection_ref: d.inspection?.ref_no ?? null,
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not prepare the note'))
      .finally(() => setLoading(false));
  }, [inspectionId, observationIds, user?.name, user?.designation]);

  const selected = useMemo(
    () => (draft?.observations ?? []).filter((o) => include.has(o.id)).map((o, index) => ({ ...o, sl_no: index + 1 })),
    [draft, include]
  );

  const save = async (status: 'draft' | 'issued') => {
    if (!fields || selected.length === 0) return;
    setSaving(true);
    try {
      const note = await api.post<InspectionNote>('/notes', {
        inspection_id: inspectionId ? Number(inspectionId) : undefined,
        observation_ids: inspectionId ? undefined : selected.map((o) => o.id),
        ...fields,
        status,
      });
      toast.success(
        status === 'issued' ? `${note.note_no} issued` : `${note.note_no} saved as a draft`
      );
      navigate(`/notes/${note.id}`, { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the note');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Preparing the inspection note" />;
  if (error || !draft || !fields) {
    return <Card><EmptyState icon="alert" title="Nothing to compile" text={error ?? undefined} /></Card>;
  }

  const set = (key: keyof LetterFields) => (value: string) => setFields((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => navigate(-1)}>Back</Button>
        <span className="spacer" />
        <Link to="/notes" className="btn btn--ghost btn--sm"><Icon name="file" size={14} /> All notes</Link>
      </div>

      <div className="page-head">
        <h1>Inspection Note</h1>
        <p>
          {draft.inspection
            ? `Compiling ${draft.observations.length} observation(s) of ${draft.inspection.ref_no} into one letter.`
            : `Compiling ${draft.observations.length} selected observation(s) into one letter.`}
        </p>
      </div>

      {draft.observations.length === 0 ? (
        <Card>
          <EmptyState
            icon="check"
            title="No observation to compile"
            text="This inspection recorded no deficiency, so there is nothing to write about."
          />
        </Card>
      ) : (
        <>
          <Card title="Observations to include" icon="clipboard" subtitle={`${selected.length} of ${draft.observations.length} selected`}>
            <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              {draft.observations.map((o) => (
                <label key={o.id} className="pick">
                  <input
                    type="checkbox"
                    checked={include.has(o.id)}
                    onChange={(e) => {
                      const next = new Set(include);
                      if (e.target.checked) next.add(o.id);
                      else next.delete(o.id);
                      setInclude(next);
                    }}
                  />
                  <span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="obs__ref">{o.ref_no}</span>
                      <Badge tone="outline">{o.department_name}</Badge>
                      {o.tdc && <span className="xsmall muted">TDC {formatDate(o.tdc)}</span>}
                      {o.repeat_count > 0 && <Badge tone="warning">Repeat</Badge>}
                    </span>
                    <span className="small clamp-2" style={{ display: 'block', marginTop: 2 }}>
                      {[o.unit_name, o.item_name].filter(Boolean).join(' · ')} — {o.observation}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Card>

          <Card title="Letter" icon="edit">
            <Field label="Subject" required>
              <textarea
                className="textarea"
                style={{ minHeight: 56 }}
                value={fields.subject}
                onChange={(e) => set('subject')(e.target.value)}
              />
            </Field>
            <div className="grid-2">
              <Field label="Note number" hint="The next number in the office series">
                <input className="input" value={fields.note_no} onChange={(e) => set('note_no')(e.target.value)} />
              </Field>
              <Field label="Date">
                <input
                  className="input"
                  type="date"
                  value={fields.letter_date}
                  onChange={(e) => set('letter_date')(e.target.value)}
                />
              </Field>
            </div>
            <Field label="To">
              <input className="input" value={fields.addressee ?? ''} onChange={(e) => set('addressee')(e.target.value)} />
            </Field>
            <Field label="Opening paragraph">
              <textarea
                className="textarea"
                style={{ minHeight: 84 }}
                value={fields.preamble ?? ''}
                onChange={(e) => set('preamble')(e.target.value)}
              />
            </Field>
            <Field label="Closing paragraph">
              <textarea
                className="textarea"
                style={{ minHeight: 64 }}
                value={fields.closing ?? ''}
                onChange={(e) => set('closing')(e.target.value)}
              />
            </Field>
            <div className="grid-2">
              <Field label="Signed by">
                <input className="input" value={fields.signatory_name ?? ''} onChange={(e) => set('signatory_name')(e.target.value)} />
              </Field>
              <Field label="Designation">
                <input
                  className="input"
                  value={fields.signatory_designation ?? ''}
                  onChange={(e) => set('signatory_designation')(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Copy to">
              <textarea
                className="textarea"
                style={{ minHeight: 52 }}
                value={fields.copy_to ?? ''}
                onChange={(e) => set('copy_to')(e.target.value)}
              />
            </Field>
            <label className="pick">
              <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
              <span className="small">Group the table by the department that has to act</span>
            </label>
          </Card>

          <div className="section-label">Preview</div>
          <div className="letter-wrap">
            <Letter fields={fields} observations={selected} groupByDepartment={grouped} />
          </div>

          <div className="row row--wrap" style={{ gap: 8 }}>
            <Button variant="quiet" icon="file" loading={saving} onClick={() => save('draft')} disabled={selected.length === 0}>
              Save as draft
            </Button>
            <span className="spacer" />
            <Button icon="send" loading={saving} onClick={() => save('issued')} disabled={selected.length === 0}>
              Issue the note
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View one note                                                              */
/* -------------------------------------------------------------------------- */

export function NoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [note, setNote] = useState<InspectionNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState(true);
  const [showStatus, setShowStatus] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.get<InspectionNote>(`/notes/${id}`)
      .then(setNote)
      .catch(() => setNote(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const issue = async () => {
    if (!note) return;
    try {
      const updated = await api.patch<InspectionNote>(`/notes/${note.id}`, { status: 'issued' });
      setNote(updated);
      toast.success(`${updated.note_no} issued`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not issue the note');
    }
  };

  if (loading && !note) return <Loading label="Opening the note" />;
  if (!note) return <Card><EmptyState icon="alert" title="Inspection note not found" /></Card>;

  const closed = note.observations.filter((o) => o.status === 'closed').length;

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row row--wrap no-print" style={{ gap: 8 }}>
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => navigate(-1)}>Back</Button>
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon="printer" onClick={() => window.print()}>Print</Button>
        {!IS_DEMO && (
          <a
            className="btn btn--ghost btn--sm"
            href={reportUrl(`/notes/${note.id}/print`, { format: 'pdf', group_by_department: grouped ? 1 : 0 })}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="download" size={14} /> PDF
          </a>
        )}
        {note.status === 'draft' && <Button size="sm" icon="send" onClick={issue}>Issue</Button>}
      </div>

      <Card pad className="no-print">
        <div className="row row--wrap" style={{ gap: 7, marginBottom: 6 }}>
          <h1 style={{ fontSize: '1rem' }}>{note.note_no}</h1>
          <Badge tone={note.status === 'issued' ? 'good' : note.status === 'cancelled' ? 'neutral' : 'warning'}>
            {titleCase(note.status)}
          </Badge>
        </div>
        <dl className="kv">
          <dt>Subject</dt><dd>{note.subject}</dd>
          <dt>Date</dt><dd>{letterDate(note.letter_date)}</dd>
          {note.inspection_ref && (
            <>
              <dt>Inspection</dt>
              <dd><Link to={`/inspections/${note.inspection_id}`}>{note.inspection_ref}</Link></dd>
            </>
          )}
          {note.station_name && (
            <>
              <dt>Station</dt>
              <dd><Link to={`/stations/${note.station_id}`}>{note.station_name}</Link></dd>
            </>
          )}
          <dt>Raised by</dt><dd>{note.created_by_name} · {formatDateTime(note.created_at)}</dd>
          {note.issued_at && (<><dt>Issued</dt><dd>{formatDateTime(note.issued_at)}</dd></>)}
          <dt>Items</dt>
          <dd>
            <b className="mono-num">{note.observations.length}</b> observation(s) ·{' '}
            <b className="mono-num">{closed}</b> since closed
          </dd>
        </dl>
        <div className="row row--wrap" style={{ gap: 14, marginTop: 10 }}>
          <label className="pick">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            <span className="small">Group by department</span>
          </label>
          <label className="pick">
            <input type="checkbox" checked={showStatus} onChange={(e) => setShowStatus(e.target.checked)} />
            <span className="small">Show the present status of each item</span>
          </label>
        </div>
      </Card>

      {note.status === 'issued' && (
        <Banner tone="info" icon="info">
          This note has been issued, so its wording is fixed. The status column reads live, so reopening it shows where
          each item now stands against the letter as it went out.
        </Banner>
      )}

      <div className="letter-wrap">
        <Letter
          fields={{ ...note, inspection_ref: note.inspection_ref ?? null }}
          observations={note.observations}
          groupByDepartment={grouped}
          showStatus={showStatus}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

export function Notes() {
  const [data, setData] = useState<NoteSummary[] | null>(null);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    api.get<{ data: NoteSummary[] }>('/notes', { status: status || undefined, limit: 100 })
      .then((r) => setData(r.data))
      .catch(() => setData([]));
  }, [status]);

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Inspection Notes</h1>
        <p>Observations compiled into numbered letters, in the office format.</p>
      </div>

      <div className="chips">
        {[['', 'All'], ['issued', 'Issued'], ['draft', 'Drafts'], ['cancelled', 'Cancelled']].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip${status === value ? ' chip--on' : ''}`}
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {!data ? (
        <Loading label="Loading notes" />
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon="file"
            title="No inspection note yet"
            text="Open a completed inspection and choose Inspection Note to compile its observations into a letter."
          />
        </Card>
      ) : (
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {data.map((n) => (
            <Link
              key={n.id}
              to={`/notes/${n.id}`}
              className="obs"
              style={{ '--tone': 'var(--accent)' } as React.CSSProperties}
            >
              <div className="obs__top">
                <span className="obs__ref">{n.note_no}</span>
                <Badge tone={n.status === 'issued' ? 'good' : n.status === 'cancelled' ? 'neutral' : 'warning'}>
                  {titleCase(n.status)}
                </Badge>
                {n.module_code && <Badge tone="outline">{n.module_code}</Badge>}
                <span className="spacer" />
                <Icon name="chevron-right" size={16} />
              </div>
              <div className="obs__text clamp-2">{n.subject}</div>
              <div className="obs__meta">
                <span>{formatDate(n.letter_date)}</span>
                <span>{n.observation_count} item(s)</span>
                {n.closed_count > 0 && <span>{n.closed_count} closed</span>}
                {n.station_name && <span>{n.station_name}</span>}
                {n.inspection_ref && <span>{n.inspection_ref}</span>}
                <span>Raised by {n.created_by_name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
