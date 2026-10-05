import {
  useEffect, useId, useMemo, useRef, useState, type ReactNode, type ChangeEvent,
} from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from './Icon';
import { STATUS_LABEL, severityTone, statusTone, tdcText, titleCase, WORKFLOW, workflowPosition } from '../lib/format';
import type { ObservationStatus } from '../api/types';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export function Card({
  title, subtitle, action, children, pad = true, className = '', icon,
}: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode;
  pad?: boolean; className?: string; icon?: IconName;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card__head">
          {icon && <span style={{ color: 'var(--accent)' }}><Icon name={icon} size={17} /></span>}
          <div style={{ minWidth: 0 }}>
            {title && <h2 style={{ fontSize: '0.95rem' }}>{title}</h2>}
            {subtitle && <div className="card__head-sub">{subtitle}</div>}
          </div>
          {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
        </header>
      )}
      {pad ? <div className="card__body">{children}</div> : children}
    </section>
  );
}

export function Field({
  label, required, hint, error, children, htmlFor,
}: {
  label: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode;
  children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <div className="field__hint">{hint}</div>}
      {error && <div className="field__error" role="alert">{error}</div>}
    </div>
  );
}

export function Badge({
  tone = 'neutral', children, dot, size,
}: { tone?: string; children: ReactNode; dot?: boolean; size?: 'lg' }) {
  return (
    <span className={`badge badge--${tone}${size === 'lg' ? ' badge--lg' : ''}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export const StatusBadge = ({ status }: { status: ObservationStatus }) => (
  <Badge tone={statusTone(status)} dot>{STATUS_LABEL[status] ?? titleCase(status)}</Badge>
);

/** Severity always carries its name, never colour alone. */
export const SeverityBadge = ({ name }: { name?: string | null }) => (
  <Badge tone={severityTone(name)}>{name ?? 'Unrated'}</Badge>
);

export const OverdueBadge = ({
  tdc, days, isOverdue,
}: { tdc: string | null; days: number | null; isOverdue: boolean }) => {
  if (!tdc) return <Badge tone="outline">No TDC</Badge>;
  const tone = isOverdue ? 'critical' : days != null && days <= 3 ? 'warning' : 'outline';
  return (
    <Badge tone={tone}>
      {isOverdue && <Icon name="alert" size={12} />}
      {tdcText(tdc, days, isOverdue)}
    </Badge>
  );
};

export function Button({
  children, icon, variant, size, block, loading, type = 'button', ...rest
}: {
  children?: ReactNode; icon?: IconName;
  variant?: 'ghost' | 'quiet' | 'good' | 'danger' | 'warning';
  size?: 'sm' | 'lg'; block?: boolean; loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['btn'];
  if (variant) classes.push(`btn--${variant}`);
  if (size) classes.push(`btn--${size}`);
  if (block) classes.push('btn--block');
  return (
    <button type={type} className={classes.join(' ')} disabled={rest.disabled || loading} {...rest}>
      {loading ? <Spinner size={16} /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 17} />}
      {children}
    </button>
  );
}

export const Spinner = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'spin 0.9s linear infinite' }}>
    <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const Loading = ({ label = 'Loading' }: { label?: string }) => (
  <div className="center" style={{ padding: '30px 12px', color: 'var(--muted)' }}>
    <Spinner /> <div className="small" style={{ marginTop: 8 }}>{label}...</div>
  </div>
);

export function Skeletons({ rows = 3, height = 62 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = 'clipboard', title, text, action,
}: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon name={icon} size={30} /></div>
      <div className="empty__title">{title}</div>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function Banner({
  tone = 'info', icon, children, action,
}: { tone?: 'info' | 'warn' | 'danger' | 'good'; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  const fallback: Record<string, IconName> = { info: 'info', warn: 'alert', danger: 'alert', good: 'check' };
  return (
    <div className={`banner banner--${tone}`}>
      <span className="banner__icon"><Icon name={icon ?? fallback[tone] ?? 'info'} size={16} /></span>
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Searchable dropdown - the backbone of "minimal typing"                     */
/* -------------------------------------------------------------------------- */

export interface Option {
  value: number | string;
  label: string;
  sub?: string;
  group?: string;
  keywords?: string;
}

export function SearchSelect({
  options, value, onChange, placeholder = 'Select', searchPlaceholder = 'Type to search',
  disabled, allowClear = true, emptyText = 'No match found', id, onSearch, loading,
}: {
  options: Option[];
  value: number | string | null;
  onChange: (value: number | string | null, option: Option | null) => void;
  placeholder?: string; searchPlaceholder?: string; disabled?: boolean;
  allowClear?: boolean; emptyText?: string; id?: string;
  /** When given, filtering happens on the server. */
  onSearch?: (term: string) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const selected = options.find((o) => String(o.value) === String(value)) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const filtered = useMemo(() => {
    if (onSearch || !term.trim()) return options;
    const needle = term.trim().toLowerCase();
    return options.filter((o) =>
      `${o.label} ${o.sub ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(needle)
    );
  }, [options, term, onSearch]);

  const grouped = useMemo(() => {
    const map = new Map<string, Option[]>();
    for (const option of filtered) {
      const key = option.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(option);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="combo" ref={boxRef}>
      <button
        type="button"
        id={id ?? autoId}
        className={`combo__value${selected ? '' : ' combo__value--empty'}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="truncate" style={{ display: 'block' }}>{selected ? selected.label : placeholder}</span>
          {selected?.sub && <span className="xsmall muted truncate" style={{ display: 'block' }}>{selected.sub}</span>}
        </span>
        {selected && allowClear ? (
          <span
            className="combo__clear"
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null, null);
            }}
          >
            <Icon name="close" size={15} />
          </span>
        ) : (
          <Icon name="chevron-down" size={15} />
        )}
      </button>

      {open && (
        <div className="combo__panel" role="listbox">
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <input
              ref={inputRef}
              className="input"
              style={{ minHeight: 38 }}
              placeholder={searchPlaceholder}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                onSearch?.(e.target.value);
              }}
            />
          </div>
          {loading && <div className="combo__empty"><Spinner size={16} /></div>}
          {!loading && filtered.length === 0 && <div className="combo__empty">{emptyText}</div>}
          {grouped.map(([group, items]) => (
            <div key={group || 'all'}>
              {group && <div className="combo__group">{group}</div>}
              {items.map((option) => (
                <button
                  key={`${group}-${option.value}`}
                  type="button"
                  className="combo__opt"
                  role="option"
                  aria-selected={String(option.value) === String(value)}
                  onClick={() => {
                    onChange(option.value, option);
                    setOpen(false);
                    setTerm('');
                  }}
                >
                  <span className="combo__opt-title">{option.label}</span>
                  {option.sub && <span className="combo__opt-sub" style={{ display: 'block' }}>{option.sub}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tiles, workflow strip, sheets, pagination                             */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label, value, foot, tone, to, icon,
}: {
  label: string; value: ReactNode; foot?: ReactNode;
  tone?: 'alert' | 'warn' | 'accent'; to?: string; icon?: IconName;
}) {
  const body = (
    <>
      <div className="tile__label">
        {icon && <Icon name={icon} size={13} />} {label}
      </div>
      <div className={`tile__value${tone === 'alert' ? ' tile__value--alert' : tone === 'warn' ? ' tile__value--warn' : ''} mono-num`}>
        {value}
      </div>
      {foot && <div className="tile__foot">{foot}</div>}
    </>
  );
  const className = `tile${tone === 'accent' ? ' tile--accent' : ''}`;
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export function WorkflowStrip({ status }: { status: ObservationStatus }) {
  const position = workflowPosition(status);
  if (status === 'cancelled') {
    return <div className="flow"><span className="flow__pill flow__pill--now">Cancelled</span></div>;
  }
  return (
    <div className="flow" role="img" aria-label={`Workflow position: ${STATUS_LABEL[status]}`}>
      {WORKFLOW.map((step, index) => (
        <span className="flow__step" key={step}>
          {index > 0 && <span className="flow__arrow" aria-hidden="true" />}
          <span
            className={`flow__pill${index < position ? ' flow__pill--done' : index === position ? ' flow__pill--now' : ''}`}
          >
            {STATUS_LABEL[step]}
          </span>
        </span>
      ))}
      {(status === 'rejected' || status === 'reopened') && (
        <span className="flow__step">
          <span className="flow__arrow" aria-hidden="true" />
          <span className="flow__pill flow__pill--now">{STATUS_LABEL[status]}</span>
        </span>
      )}
    </div>
  );
}

export function Sheet({
  title, subtitle, onClose, children, footer, wide,
}: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void;
  children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={wide ? { maxWidth: 860 } : undefined} role="dialog" aria-modal="true">
        <header className="sheet__head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '1rem' }}>{title}</h2>
            {subtitle && <div className="xsmall muted">{subtitle}</div>}
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Pager({
  page, totalPages, total, onPage,
}: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return <div className="center xsmall muted" style={{ padding: '10px 0' }}>{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="pager">
      <Button size="sm" variant="ghost" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="small muted mono-num">
        Page {page} of {totalPages} &middot; {total} records
      </span>
      <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next <Icon name="chevron-right" size={14} />
      </Button>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs, value, onChange,
}: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tab.key === value}
          className={tab.key === value ? 'on' : ''}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="muted mono-num"> ({tab.count})</span>}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

export function PhotoPicker({
  files, onChange, max = 8, label = 'Add photo',
}: { files: File[]; onChange: (files: File[]) => void; max?: number; label?: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const created = files.map((f) => URL.createObjectURL(f));
    setUrls(created);
    return () => created.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const add = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length) onChange([...files, ...picked].slice(0, max));
    event.target.value = '';
  };

  return (
    <div>
      <div className="photo-grid">
        {urls.map((url, index) => (
          <div className="photo-grid__item" key={url}>
            <img src={url} alt={`Evidence ${index + 1}`} />
            <button
              type="button"
              className="photo-grid__remove"
              aria-label={`Remove photo ${index + 1}`}
              onClick={() => onChange(files.filter((_, i) => i !== index))}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
        {files.length < max && (
          <>
            <button type="button" className="photo-add" onClick={() => cameraRef.current?.click()}>
              <Icon name="camera" size={20} />
              {label}
            </button>
            <button type="button" className="photo-add" onClick={() => galleryRef.current?.click()}>
              <Icon name="file" size={20} />
              From files
            </button>
          </>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={add} />
      <input ref={galleryRef} type="file" accept="image/*,video/*,application/pdf" multiple hidden onChange={add} />
      {files.length > 0 && (
        <div className="xsmall muted" style={{ marginTop: 6 }}>
          {files.length} file{files.length === 1 ? '' : 's'} attached
        </div>
      )}
    </div>
  );
}

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0b2e4f';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="sign-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = canvasRef.current?.getContext('2d');
          if (!ctx) return;
          drawing.current = true;
          dirty.current = true;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext('2d');
          if (!ctx) return;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(canvasRef.current?.toDataURL('image/png') ?? null);
        }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <span className="xsmall muted">Sign above with a finger, stylus or mouse</span>
        <span className="spacer" />
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            dirty.current = false;
            onChange(null);
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
