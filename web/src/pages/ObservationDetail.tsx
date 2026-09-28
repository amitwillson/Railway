import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fileUrl } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import Icon from '../components/Icon';
import {
  Badge, Banner, Button, Card, EmptyState, Field, Loading, OverdueBadge, PhotoPicker,
  SearchSelect, SeverityBadge, Sheet, SignaturePad, StatusBadge, WorkflowStrip,
} from '../components/ui';
import { formatDate, formatDateTime, relativeTime, titleCase } from '../lib/format';
import type { ObservationDetail as Detail, Supervisor } from '../api/types';

type Dialog = 'acknowledge' | 'progress' | 'compliance' | 'verify' | 'reassign' | 'cancel' | 'reopen' | 'tdc' | null;

export default function ObservationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { masters, refreshCounters } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [comparison, setComparison] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.get<Detail>(`/observations/${id}`)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const afterAction = (message: string) => {
    toast.success(message);
    setDialog(null);
    load();
    void refreshCounters();
  };

  if (loading && !detail) return <Loading label="Opening observation" />;
  if (!detail) {
    return (
      <Card>
        <EmptyState icon="alert" title="Observation not found" text="It may have been cancelled, or you may not have access to it." />
      </Card>
    );
  }

  const o = detail;
  const perms = o.permissions;
  const evidence = o.attachments.filter((a) => a.phase === 'observation');
  const complianceEvidence = o.attachments.filter((a) => a.phase === 'compliance');

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => navigate(-1)}>Back</Button>
        <span className="spacer" />
        <Badge tone="outline">{o.module_name}</Badge>
      </div>

      <Card pad>
        <div className="row row--wrap" style={{ gap: 7, marginBottom: 8 }}>
          <h1 style={{ fontSize: '1.05rem' }}>{o.ref_no}</h1>
          <StatusBadge status={o.status} />
          <SeverityBadge name={o.severity_name} />
          <OverdueBadge tdc={o.tdc} days={o.days_to_tdc} isOverdue={o.is_overdue} />
          {o.repeat_count > 0 && (
            <Badge tone="warning"><Icon name="repeat" size={11} /> Repeated ×{o.repeat_count + 1}</Badge>
          )}
          {o.escalation_level > 0 && <Badge tone="critical">Escalated to level {o.escalation_level}</Badge>}
          {o.requires_physical_verification && <Badge tone="info">Physical verification required</Badge>}
        </div>

        <p style={{ fontSize: '1rem', lineHeight: 1.55, marginBottom: 12 }}>{o.observation}</p>

        <WorkflowStrip status={o.status} />

        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Location</dt>
          <dd>
            {o.station_id ? (
              <Link to={`/stations/${o.station_id}`}>{o.location_label}</Link>
            ) : o.train_id ? (
              <Link to={`/trains/${o.train_id}`}>{o.location_label}</Link>
            ) : (
              o.location_label
            )}
          </dd>
          <dt>Unit / Area</dt><dd>{o.unit_name ?? '-'}{o.coach ? ` · Coach ${o.coach}` : ''}</dd>
          <dt>{o.module_code === 'PA' ? 'Amenity / Service' : 'Inspection item'}</dt><dd>{o.item_name ?? '-'}</dd>
          <dt>Category</dt><dd>{o.category_name ?? '-'}</dd>
          <dt>Action by</dt><dd>{o.department_name}</dd>
          <dt>Concerned supervisor</dt>
          <dd>
            {o.supervisor ? (
              <>
                {o.supervisor.name}
                {o.supervisor.designation ? `, ${o.supervisor.designation}` : ''}
                <div className="xsmall muted">
                  {[o.supervisor.mobile, o.supervisor.email].filter(Boolean).join(' · ')}
                  {o.supervisor.reporting_officer_name && ` · Reports to ${o.supervisor.reporting_officer_name}`}
                </div>
                <div className="xsmall muted">Assignment: {titleCase(o.assignment_mode)}</div>
              </>
            ) : (
              <span className="muted">Not assigned - the divisional office has been informed</span>
            )}
          </dd>
          <dt>TDC</dt>
          <dd>
            {o.tdc ? formatDate(o.tdc) : 'Not specified'}
            {perms.can_reassign && (
              <button className="chart__toggle" style={{ marginLeft: 6 }} onClick={() => setDialog('tdc')}>Change</button>
            )}
          </dd>
          <dt>Inspecting officer</dt>
          <dd>{o.inspector_name}{o.inspector_designation ? `, ${o.inspector_designation}` : ''}</dd>
          <dt>Observed on</dt><dd>{formatDateTime(o.observed_at)} <span className="muted">({relativeTime(o.observed_at)})</span></dd>
          <dt>Inspection</dt><dd><Link to={`/inspections/${o.inspection_id}`}>{o.inspection_ref}</Link> · {o.inspection_type_name}</dd>
          {o.rule_reference && (
            <>
              <dt>Linked instruction</dt>
              <dd>
                <Icon name="link" size={12} /> {o.rule_reference.code} - {o.rule_reference.title}
                <div className="xsmall muted">{o.rule_reference.authority} {o.rule_reference.reference_no}</div>
              </dd>
            </>
          )}
          {o.parameters.length > 0 && (
            <>
              <dt>Checklist</dt>
              <dd>
                <div className="chips">
                  {o.parameters.map((p) => <span className="badge badge--outline" key={p.name}>{p.name}</span>)}
                </div>
              </dd>
            </>
          )}
          {o.cancel_reason && (<><dt>Cancelled because</dt><dd>{o.cancel_reason}</dd></>)}
        </dl>
      </Card>

      {/* Actions */}
      {(perms.can_acknowledge || perms.can_submit_compliance || perms.can_verify || perms.can_reassign || perms.can_cancel) && (
        <Card title="Actions" icon="check">
          <div className="btn-group">
            {perms.can_acknowledge && <Button icon="check" onClick={() => setDialog('acknowledge')}>Acknowledge</Button>}
            {perms.can_submit_compliance && (
              <>
                <Button variant="quiet" icon="clock" onClick={() => setDialog('progress')}>Action in progress</Button>
                <Button variant="good" icon="send" onClick={() => setDialog('compliance')}>Submit compliance</Button>
              </>
            )}
            {perms.can_verify && <Button variant="good" icon="shield" onClick={() => setDialog('verify')}>Verify compliance</Button>}
            {perms.can_reassign && o.is_open && (
              <Button variant="ghost" icon="users" onClick={() => setDialog('reassign')}>Reassign</Button>
            )}
            {o.status === 'closed' && perms.can_reassign && (
              <Button variant="ghost" icon="repeat" onClick={() => setDialog('reopen')}>Reopen</Button>
            )}
            {perms.can_cancel && o.is_open && (
              <Button variant="ghost" icon="close" onClick={() => setDialog('cancel')}>Cancel</Button>
            )}
          </div>
        </Card>
      )}

      {/* Repeated deficiency */}
      {o.repeats.count > 0 && (
        <Card
          title="Repeated deficiency"
          subtitle={o.repeats.message ?? undefined}
          icon="repeat"
          action={
            <Button size="sm" variant="ghost" onClick={() => setComparison(true)}>Compare photos</Button>
          }
          pad={false}
        >
          <div style={{ padding: '2px 0' }}>
            {o.repeats.matches.map((m) => (
              <Link
                key={m.id}
                to={`/observations/${m.id}`}
                style={{ display: 'block', padding: '10px 14px', borderBottom: '1px solid var(--line)', color: 'inherit', textDecoration: 'none' }}
              >
                <div className="row row--wrap" style={{ gap: 6 }}>
                  <span className="obs__ref">{m.ref_no}</span>
                  <Badge tone="outline">{m.match_reason}</Badge>
                  <Badge tone="outline">{Math.round(m.similarity * 100)}% similar</Badge>
                  <span className="spacer" />
                  <span className="xsmall muted">{formatDate(m.observed_at)}</span>
                </div>
                <div className="small clamp-2" style={{ marginTop: 3 }}>{m.observation}</div>
                <div className="xsmall muted">{titleCase(m.status)} · {m.inspector_name} · {m.photo_count} photo(s)</div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Evidence */}
      <Card title={`Photographic evidence (${evidence.length})`} icon="camera">
        {evidence.length === 0 ? (
          <p className="small muted">No photograph was attached when this observation was recorded.</p>
        ) : (
          <div className="photo-grid">
            {evidence.map((a) => (
              <a className="photo-grid__item" key={a.id} href={fileUrl(a.stored_name)} target="_blank" rel="noreferrer">
                <img src={fileUrl(a.stored_name)} alt={a.caption ?? a.file_name} loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {complianceEvidence.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 14 }}>Compliance evidence</div>
            <div className="photo-grid">
              {complianceEvidence.map((a) => (
                <a className="photo-grid__item" key={a.id} href={fileUrl(a.stored_name)} target="_blank" rel="noreferrer">
                  <img src={fileUrl(a.stored_name)} alt={a.caption ?? a.file_name} loading="lazy" />
                </a>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Compliance rounds */}
      {o.compliances.length > 0 && (
        <Card title={`Compliance (${o.compliances.length} round${o.compliances.length === 1 ? '' : 's'})`} icon="check" pad={false}>
          <div>
            {o.compliances.map((c) => (
              <div key={c.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                <div className="row row--wrap" style={{ gap: 6, marginBottom: 5 }}>
                  <Badge tone="outline">Round {c.round}</Badge>
                  <Badge tone={c.status === 'accepted' ? 'good' : c.status === 'rejected' ? 'critical' : c.status === 'submitted' ? 'info' : 'warning'}>
                    {titleCase(c.status)}
                  </Badge>
                  <span className="spacer" />
                  <span className="xsmall muted">{formatDate(c.compliance_date)}</span>
                </div>
                <div className="small"><strong>Action taken:</strong> {c.action_taken}</div>
                {c.remarks && <div className="small muted" style={{ marginTop: 3 }}>Remarks: {c.remarks}</div>}
                <div className="xsmall muted" style={{ marginTop: 4 }}>
                  Submitted by {c.submitted_by_name}{c.submitted_by_designation ? `, ${c.submitted_by_designation}` : ''} on {formatDateTime(c.submitted_at)}
                </div>
                {c.verified_at && (
                  <div className="xsmall muted">
                    Verified by {c.verified_by_name} on {formatDateTime(c.verified_at)}
                    {c.verification_remarks ? ` - ${c.verification_remarks}` : ''}
                  </div>
                )}
                {c.rejection_reason && (
                  <div className="small" style={{ marginTop: 5, color: 'var(--critical)' }}>
                    <Icon name="alert" size={12} /> Rejected: {c.rejection_reason}
                  </div>
                )}
                {c.attachments && c.attachments.length > 0 && (
                  <div className="obs__strip" style={{ marginTop: 7 }}>
                    {c.attachments.map((a) => (
                      <a key={a.id} href={fileUrl(a.stored_name)} target="_blank" rel="noreferrer">
                        <img className="obs__thumb" src={fileUrl(a.stored_name)} alt={a.file_name} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Timeline */}
      <Card title="History" subtitle="Every action on this observation is recorded" icon="clock">
        <div className="timeline">
          {o.timeline.map((event) => (
            <div className="timeline__item" key={event.id}>
              <span className="timeline__dot" />
              <div className="timeline__title">{titleCase(event.action)}</div>
              <div className="timeline__meta">
                {formatDateTime(event.created_at)} · {event.actor_name}
                {event.actor_role ? ` (${titleCase(event.actor_role)})` : ''}
              </div>
              {event.remarks && <div className="timeline__note">{event.remarks}</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* Signatures */}
      {o.approvals.length > 0 && (
        <Card title="Acknowledgement & signatures" icon="signature">
          {o.approvals.map((a) => (
            <div key={a.id} className="row" style={{ gap: 10, marginBottom: 8 }}>
              {a.signature_data && (
                <img src={a.signature_data} alt="Signature" style={{ height: 40, background: '#fff', borderRadius: 4, border: '1px solid var(--line)' }} />
              )}
              <div>
                <div className="small strong">{a.user_name}{a.designation ? `, ${a.designation}` : ''}</div>
                <div className="xsmall muted">{titleCase(a.approval_role)} · {formatDateTime(a.signed_at)}</div>
                {a.remarks && <div className="xsmall">{a.remarks}</div>}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Notification trail */}
      {o.notifications.length > 0 && (
        <Card title="Notifications sent" icon="bell" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>When</th><th>Event</th><th>Recipient</th><th>Channels</th></tr>
              </thead>
              <tbody>
                {o.notifications.map((n) => (
                  <tr key={n.id}>
                    <td className="xsmall">{formatDateTime(n.created_at)}</td>
                    <td className="xsmall">{titleCase(n.event)}</td>
                    <td className="xsmall">{n.recipient}</td>
                    <td className="xsmall">{n.channels ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dialog && (
        <ActionDialog
          dialog={dialog}
          detail={o}
          onClose={() => setDialog(null)}
          onDone={afterAction}
          severities={masters?.severities ?? []}
          departments={masters?.departments ?? []}
        />
      )}
      {comparison && <PhotoComparison observationId={o.id} onClose={() => setComparison(false)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Action dialogs                                                             */
/* -------------------------------------------------------------------------- */

function ActionDialog({
  dialog, detail, onClose, onDone, departments,
}: {
  dialog: Exclude<Dialog, null>;
  detail: Detail;
  onClose: () => void;
  onDone: (message: string) => void;
  severities: { id: number; name: string }[];
  departments: { id: number; name: string }[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [complianceDate, setComplianceDate] = useState(new Date().toISOString().slice(0, 10));
  const [files, setFiles] = useState<File[]>([]);
  const [decision, setDecision] = useState<'accept' | 'reject' | 'physical_verification'>('accept');
  const [reason, setReason] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(detail.action_by_department_id);
  const [supervisorId, setSupervisorId] = useState<number | null>(detail.supervisor_id);
  const [candidates, setCandidates] = useState<Supervisor[]>([]);
  const [tdc, setTdc] = useState(detail.tdc ?? '');

  useEffect(() => {
    if (dialog !== 'reassign' || !departmentId) return;
    api.get<{ data: Supervisor[]; auto_selected: Supervisor | null }>('/masters/supervisors/resolve', {
      station_id: detail.station_id ?? undefined,
      unit_id: detail.unit_id ?? undefined,
      department_id: departmentId,
      item_id: detail.item_id ?? undefined,
    })
      .then((r) => {
        setCandidates(r.data);
        setSupervisorId(r.auto_selected?.id ?? null);
      })
      .catch(() => {});
  }, [dialog, departmentId, detail]);

  const run = async () => {
    setBusy(true);
    try {
      switch (dialog) {
        case 'acknowledge':
          await api.post(`/observations/${detail.id}/acknowledge`, { remarks: remarks || undefined });
          onDone('Observation acknowledged');
          break;
        case 'progress':
          await api.post(`/observations/${detail.id}/progress`, { remarks });
          onDone('Marked as action in progress');
          break;
        case 'compliance': {
          const form = new FormData();
          form.append('action_taken', actionTaken);
          if (remarks) form.append('remarks', remarks);
          form.append('compliance_date', complianceDate);
          files.forEach((f) => form.append('files', f));
          await api.postForm(`/observations/${detail.id}/compliance`, form);
          onDone('Compliance submitted. The inspecting officer has been notified.');
          break;
        }
        case 'verify':
          await api.post(`/observations/${detail.id}/verify`, {
            decision,
            remarks: remarks || undefined,
            rejection_reason: decision === 'reject' ? reason : undefined,
            signature_data: signature ?? undefined,
          });
          onDone(
            decision === 'accept'
              ? 'Compliance accepted - observation closed'
              : decision === 'reject'
                ? 'Compliance rejected - observation reopened'
                : 'Marked for physical verification'
          );
          break;
        case 'reassign':
          await api.post(`/observations/${detail.id}/reassign`, {
            action_by_department_id: departmentId ?? undefined,
            supervisor_id: supervisorId ?? undefined,
            reason,
          });
          onDone('Observation reassigned');
          break;
        case 'cancel':
          await api.post(`/observations/${detail.id}/cancel`, { reason });
          onDone('Observation cancelled');
          break;
        case 'reopen':
          await api.post(`/observations/${detail.id}/reopen`, { reason });
          onDone('Observation reopened');
          break;
        case 'tdc':
          await api.patch(`/observations/${detail.id}`, { tdc: tdc || null, remarks: remarks || undefined });
          onDone('Target date of compliance updated');
          break;
        default:
          break;
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Exclude<Dialog, null>, string> = {
    acknowledge: 'Acknowledge observation',
    progress: 'Action in progress',
    compliance: 'Submit compliance',
    verify: 'Verify compliance',
    reassign: 'Reassign observation',
    cancel: 'Cancel observation',
    reopen: 'Reopen observation',
    tdc: 'Change target date of compliance',
  };

  const valid = () => {
    if (dialog === 'progress') return remarks.trim().length >= 3;
    if (dialog === 'compliance') return actionTaken.trim().length >= 5;
    if (dialog === 'verify') return decision !== 'reject' || reason.trim().length >= 3;
    if (dialog === 'reassign' || dialog === 'cancel' || dialog === 'reopen') return reason.trim().length >= 5;
    return true;
  };

  return (
    <Sheet
      title={titles[dialog]}
      subtitle={`${detail.ref_no} · ${detail.item_name ?? detail.category_name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button onClick={run} loading={busy} disabled={!valid()}>Confirm</Button>
        </>
      }
    >
      {dialog === 'acknowledge' && (
        <Field label="Remarks" hint="Optional">
          <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Noted, action being taken..." />
        </Field>
      )}

      {dialog === 'progress' && (
        <Field label="Progress remarks" required>
          <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Material indented, work in hand..." />
        </Field>
      )}

      {dialog === 'compliance' && (
        <>
          <Field label="Action taken" required>
            <textarea className="textarea" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} placeholder="Describe what was done to rectify the deficiency" />
          </Field>
          <Field label="Compliance remarks" hint="Optional">
            <textarea className="textarea" style={{ minHeight: 80 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <Field label="Date of compliance" required>
            <input className="input" type="date" value={complianceDate} onChange={(e) => setComplianceDate(e.target.value)} />
          </Field>
          <Field label="Photograph / supporting document">
            <PhotoPicker files={files} onChange={setFiles} label="Add evidence" />
          </Field>
        </>
      )}

      {dialog === 'verify' && (
        <>
          <Field label="Decision" required>
            <div className="chips">
              <button type="button" className={`chip${decision === 'accept' ? ' chip--on' : ''}`} onClick={() => setDecision('accept')}>
                Accept &amp; close
              </button>
              <button type="button" className={`chip${decision === 'reject' ? ' chip--on' : ''}`} onClick={() => setDecision('reject')}>
                Reject
              </button>
              <button
                type="button"
                className={`chip${decision === 'physical_verification' ? ' chip--on' : ''}`}
                onClick={() => setDecision('physical_verification')}
              >
                Physical verification required
              </button>
            </div>
          </Field>
          {decision === 'reject' && (
            <Field label="Reason for rejection" required hint="Mandatory - it is sent to the supervisor">
              <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <Field label="Verification remarks" hint="Optional">
            <textarea className="textarea" style={{ minHeight: 80 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          {decision === 'accept' && (
            <Field label="Digital signature" hint="Optional - appears on the inspection report">
              <SignaturePad onChange={setSignature} />
            </Field>
          )}
        </>
      )}

      {dialog === 'reassign' && (
        <>
          <Field label="Action by department" required>
            <SearchSelect
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              value={departmentId}
              onChange={(v) => setDepartmentId(v as number | null)}
              placeholder="Select department"
            />
          </Field>
          <Field label="Concerned supervisor" hint="Leave blank to let the system identify the supervisor">
            <SearchSelect
              options={candidates.map((c) => ({
                value: c.id, label: c.name,
                sub: [c.designation, c.station_name, c.match_reason].filter(Boolean).join(' · '),
              }))}
              value={supervisorId}
              onChange={(v) => setSupervisorId(v as number | null)}
              placeholder="Auto selected"
            />
          </Field>
          <Field label="Reason for reassignment" required>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </>
      )}

      {(dialog === 'cancel' || dialog === 'reopen') && (
        <>
          {dialog === 'cancel' && (
            <Banner tone="warn">
              A cancelled observation stays on record with its reason. It is never removed from the register.
            </Banner>
          )}
          <Field label={dialog === 'cancel' ? 'Reason for cancellation' : 'Reason for reopening'} required>
            <textarea className="textarea" style={{ marginTop: 10 }} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </>
      )}

      {dialog === 'tdc' && (
        <>
          <Field label="Target date of compliance" hint="Clear the field to remove the TDC">
            <input className="input" type="date" value={tdc} onChange={(e) => setTdc(e.target.value)} />
          </Field>
          <Field label="Remarks" hint="Recorded in the audit trail">
            <textarea className="textarea" style={{ minHeight: 80 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </>
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Photo comparison for recurring deficiencies                                */
/* -------------------------------------------------------------------------- */

interface ComparisonPayload {
  current: {
    observation: { id: number; ref_no: string; observed_at: string; observation: string; status: string };
    observation_photos: { id: number; stored_name: string }[];
    compliance_photos: { id: number; stored_name: string }[];
  };
  previous: {
    observation: { id: number; ref_no: string; observed_at: string; observation: string; match_reason: string };
    observation_photos: { id: number; stored_name: string }[];
    compliance_photos: { id: number; stored_name: string }[];
  }[];
}

function PhotoComparison({ observationId, onClose }: { observationId: number; onClose: () => void }) {
  const [data, setData] = useState<ComparisonPayload | null>(null);
  useEffect(() => {
    api.get<ComparisonPayload>(`/observations/${observationId}/photo-comparison`)
      .then(setData)
      .catch(() => setData(null));
  }, [observationId]);

  return (
    <Sheet title="Photo comparison" subtitle="Current observation against earlier occurrences" onClose={onClose} wide>
      {!data ? (
        <Loading />
      ) : (
        <div className="compare">
          <div className="compare__col">
            <div className="compare__head">
              <div className="small strong">Current · {data.current.observation.ref_no}</div>
              <div className="xsmall muted">{formatDate(data.current.observation.observed_at)}</div>
            </div>
            <div style={{ padding: 10 }}>
              <div className="photo-grid">
                {data.current.observation_photos.map((p) => (
                  <a className="photo-grid__item" key={p.id} href={fileUrl(p.stored_name)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(p.stored_name)} alt="Current observation" />
                  </a>
                ))}
              </div>
              {data.current.observation_photos.length === 0 && <p className="xsmall muted">No photograph</p>}
            </div>
          </div>
          {data.previous.map((entry) => (
            <div className="compare__col" key={entry.observation.id}>
              <div className="compare__head">
                <div className="small strong">
                  <Link to={`/observations/${entry.observation.id}`}>{entry.observation.ref_no}</Link>
                </div>
                <div className="xsmall muted">{formatDate(entry.observation.observed_at)} · {entry.observation.match_reason}</div>
              </div>
              <div style={{ padding: 10 }}>
                <div className="photo-grid">
                  {[...entry.observation_photos, ...entry.compliance_photos].map((p) => (
                    <a className="photo-grid__item" key={p.id} href={fileUrl(p.stored_name)} target="_blank" rel="noreferrer">
                      <img src={fileUrl(p.stored_name)} alt="Earlier occurrence" />
                    </a>
                  ))}
                </div>
                {entry.observation_photos.length + entry.compliance_photos.length === 0 && (
                  <p className="xsmall muted">No photograph</p>
                )}
                <p className="xsmall" style={{ marginTop: 6 }}>{entry.observation.observation}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
