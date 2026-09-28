import { Link } from 'react-router-dom';
import Icon from './Icon';
import { Badge, OverdueBadge, SeverityBadge, StatusBadge } from './ui';
import { fileUrl } from '../api/client';
import { formatDate, moduleTone, relativeTime } from '../lib/format';
import type { Observation } from '../api/types';

/** One row in every observation list in the application. */
export function ObservationCard({
  observation, showModule = true, thumbs,
}: { observation: Observation; showModule?: boolean; thumbs?: { stored_name: string }[] }) {
  const o = observation;
  const tone = moduleTone(o.module_accent);
  return (
    <Link
      to={`/observations/${o.id}`}
      className="obs"
      style={{ '--tone': `var(--mod-${tone})` } as React.CSSProperties}
    >
      <div className="obs__top">
        <span className="obs__ref">{o.ref_no}</span>
        <StatusBadge status={o.status} />
        <SeverityBadge name={o.severity_name} />
        <OverdueBadge tdc={o.tdc} days={o.days_to_tdc} isOverdue={o.is_overdue} />
        {o.repeat_count > 0 && (
          <Badge tone="warning"><Icon name="repeat" size={11} /> Repeated ×{o.repeat_count + 1}</Badge>
        )}
        {o.escalation_level > 0 && <Badge tone="critical">Escalated L{o.escalation_level}</Badge>}
        <span className="spacer" />
        {showModule && <Badge tone={tone}>{o.module_code}</Badge>}
      </div>

      <div className="obs__text clamp-3">{o.observation}</div>

      <div className="obs__meta">
        <span><Icon name="station" size={11} /> <b>{o.location_label}</b></span>
        {o.unit_name && <span>{o.unit_name}</span>}
        {o.item_name && <span><b>{o.item_name}</b></span>}
        <span><Icon name="users" size={11} /> {o.department_name}</span>
        {o.supervisor_name && <span>{o.supervisor_name}</span>}
        <span><Icon name="clock" size={11} /> {relativeTime(o.observed_at)}</span>
        {o.tdc && <span>TDC {formatDate(o.tdc)}</span>}
        {o.attachment_count > 0 && <span><Icon name="camera" size={11} /> {o.attachment_count}</span>}
      </div>

      {thumbs && thumbs.length > 0 && (
        <div className="obs__strip">
          {thumbs.slice(0, 4).map((t) => (
            <img key={t.stored_name} className="obs__thumb" src={fileUrl(t.stored_name)} alt="" loading="lazy" />
          ))}
        </div>
      )}
    </Link>
  );
}

export default ObservationCard;
