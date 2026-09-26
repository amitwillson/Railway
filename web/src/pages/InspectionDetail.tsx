import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, reportUrl } from '../api/client';
import { useToast } from '../state/ToastContext';
import Icon from '../components/Icon';
import ObservationCard from '../components/ObservationCard';
import {
  Badge, Banner, Button, Card, EmptyState, Field, Loading, Sheet, SignaturePad,
} from '../components/ui';
import { formatDate, formatDateTime, moduleTone, titleCase } from '../lib/format';
import type { Approval, Inspection, Observation } from '../api/types';

interface Payload extends Inspection {
  observations: Observation[];
  approvals: Approval[];
}

export default function InspectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [summary, setSummary] = useState<{ text: string } | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.get<Payload>(`/inspections/${id}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!id) return;
    api.get<{ text: string }>(`/inspections/${id}/summary`).then(setSummary).catch(() => {});
  }, [id, data?.observation_count]);

  if (loading && !data) return <Loading label="Opening inspection" />;
  if (!data) return <Card><EmptyState icon="alert" title="Inspection not found" /></Card>;

  const place = data.station_name
    ? `${data.station_name} (${data.station_code})`
    : [data.train_number, data.train_name].filter(Boolean).join(' ') || data.section || '-';

  const complete = async () => {
    try {
      await api.post(`/inspections/${data.id}/complete`, {
        remarks: remarks || undefined,
        signature_data: signature ?? undefined,
      });
      toast.success('Inspection completed');
      setCompleting(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not complete the inspection');
    }
  };

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => navigate(-1)}>Back</Button>
        <span className="spacer" />
        <a className="btn btn--ghost btn--sm" href={reportUrl(`/reports/inspection/${data.id}`, { format: 'pdf' })} target="_blank" rel="noreferrer">
          <Icon name="download" size={14} /> PDF
        </a>
        <a className="btn btn--ghost btn--sm" href={reportUrl(`/reports/inspection/${data.id}`, { format: 'xlsx' })}>
          <Icon name="download" size={14} /> Excel
        </a>
      </div>

      <Card pad>
        <div className="row row--wrap" style={{ gap: 7, marginBottom: 6 }}>
          <h1 style={{ fontSize: '1.05rem' }}>{data.ref_no}</h1>
          <Badge tone={data.status === 'completed' ? 'good' : 'warning'}>{titleCase(data.status)}</Badge>
          <Badge tone={moduleTone(data.module_accent)}>{data.module_name}</Badge>
        </div>
        <div className="small strong" style={{ marginBottom: 8 }}>{data.inspection_type_name}</div>
        <dl className="kv">
          <dt>Location</dt>
          <dd>
            {data.station_id ? <Link to={`/stations/${data.station_id}`}>{place}</Link> :
              data.train_id ? <Link to={`/trains/${data.train_id}`}>{place}</Link> : place}
            <div className="xsmall muted">{data.location_type}{data.station_category ? ` · ${data.station_category}` : ''}{data.division_name ? ` · ${data.division_name} Division` : ''}</div>
          </dd>
          <dt>Inspecting officer</dt>
          <dd>{data.inspector_name}{data.inspector_designation ? `, ${data.inspector_designation}` : ''}</dd>
          <dt>Started</dt><dd>{formatDateTime(data.started_at ?? data.created_at)}</dd>
          {data.completed_at && (<><dt>Completed</dt><dd>{formatDateTime(data.completed_at)}</dd></>)}
          {data.joint_with && (<><dt>Joint inspection with</dt><dd>{data.joint_with}</dd></>)}
          <dt>Observations</dt>
          <dd>
            <b className="mono-num">{data.observation_count}</b> total ·{' '}
            <b className="mono-num">{data.open_count}</b> open ·{' '}
            <b className="mono-num">{data.closed_count}</b> closed
            {data.critical_count > 0 && <> · <b className="mono-num" style={{ color: 'var(--critical)' }}>{data.critical_count}</b> critical</>}
          </dd>
        </dl>

        {data.status !== 'completed' && (
          <div className="row row--wrap" style={{ gap: 8, marginTop: 14 }}>
            <Link to={`/inspections/new?module=${data.module_code}`} className="btn btn--quiet btn--sm">
              <Icon name="plus" size={14} /> Add observation
            </Link>
            <Button size="sm" icon="check" onClick={() => setCompleting(true)}>Complete inspection</Button>
          </div>
        )}
      </Card>

      {(data.summary || summary?.text) && (
        <Card title="Automatic summary" icon="file">
          <p className="small" style={{ lineHeight: 1.6 }}>{data.summary ?? summary?.text}</p>
        </Card>
      )}

      {data.approvals.length > 0 && (
        <Card title="Signatures" icon="signature">
          {data.approvals.map((a) => (
            <div className="row" style={{ gap: 10, marginBottom: 8 }} key={a.id}>
              {a.signature_data && (
                <img src={a.signature_data} alt="Signature" style={{ height: 38, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }} />
              )}
              <div>
                <div className="small strong">{a.user_name}{a.designation ? `, ${a.designation}` : ''}</div>
                <div className="xsmall muted">{titleCase(a.approval_role)} · {formatDate(a.signed_at)}</div>
                {a.remarks && <div className="xsmall">{a.remarks}</div>}
              </div>
            </div>
          ))}
        </Card>
      )}

      <div>
        <div className="section-label">Observations ({data.observations.length})</div>
        {data.observations.length === 0 ? (
          <Card>
            <EmptyState
              icon="check"
              title="No deficiency recorded"
              text="This inspection has no observations. That is a valid outcome - the report will say so."
            />
          </Card>
        ) : (
          <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            {data.observations.map((o) => <ObservationCard key={o.id} observation={o} showModule={false} />)}
          </div>
        )}
      </div>

      {completing && (
        <Sheet
          title="Complete inspection"
          subtitle={`${data.ref_no} · ${data.observation_count} observation(s)`}
          onClose={() => setCompleting(false)}
          footer={
            <>
              <Button variant="quiet" onClick={() => setCompleting(false)}>Cancel</Button>
              <Button onClick={complete}>Complete</Button>
            </>
          }
        >
          <Banner tone="info">
            The summary is generated automatically from the observations. Every concerned supervisor has already been
            notified; completing the inspection makes the report available and informs the divisional officer.
          </Banner>
          {summary?.text && <p className="small" style={{ margin: '12px 0' }}>{summary.text}</p>}
          <Field label="Remarks" hint="Optional - appears under your signature on the report">
            <textarea className="textarea" style={{ minHeight: 80 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <Field label="Digital signature" hint="Optional">
            <SignaturePad onChange={setSignature} />
          </Field>
        </Sheet>
      )}
    </div>
  );
}
