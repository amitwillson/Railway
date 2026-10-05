import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, reportUrl } from '../api/client';
import { exportReport } from '../api/transport';
import { useAuth } from '../state/AuthContext';
import ObservationCard from '../components/ObservationCard';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, Field, Pager, SearchSelect, Skeletons } from '../components/ui';
import { STATUS_LABEL } from '../lib/format';
import type { Observation, Paged } from '../api/types';

const PRESETS = [
  { key: 'open', label: 'Pending', params: { open: '1' } },
  { key: 'overdue', label: 'Overdue', params: { overdue: '1' } },
  { key: 'awaiting_verification', label: 'Awaiting verification', params: { awaiting_verification: '1' } },
  { key: 'critical', label: 'Critical', params: { critical: '1', open: '1' } },
  { key: 'repeated', label: 'Repeated', params: { repeated: '1' } },
  { key: 'mine', label: 'Raised by me', params: { mine: '1' } },
  { key: 'assigned_to_me', label: 'Assigned to me', params: { assigned_to_me: '1' } },
  { key: 'closed', label: 'Closed', params: { closed: '1' } },
];

const SORTS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'tdc', label: 'By TDC' },
  { value: 'severity', label: 'By severity' },
  { value: 'overdue', label: 'Most overdue' },
  { value: 'status', label: 'By status' },
];

export default function Observations() {
  const { masters } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<Paged<Observation> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [term, setTerm] = useState(params.get('q') ?? '');
  /** Selection mode: pick observations across this view and compile them into one note. */
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  const query = useMemo(() => Object.fromEntries(params.entries()), [params]);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Paged<Observation>>('/observations', { ...query, page_size: 20 })
      .then(setPage)
      .catch(() => setPage(null))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  const patch = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    setParams(next);
  };

  const togglePreset = (preset: (typeof PRESETS)[number]) => {
    const active = Object.entries(preset.params).every(([k, v]) => params.get(k) === v);
    const next = new URLSearchParams(params);
    if (active) {
      Object.keys(preset.params).forEach((k) => next.delete(k));
    } else {
      // Presets are mutually exclusive on the status axis.
      ['open', 'overdue', 'awaiting_verification', 'critical', 'repeated', 'closed', 'status'].forEach((k) =>
        next.delete(k)
      );
      Object.entries(preset.params).forEach(([k, v]) => next.set(k, v));
    }
    next.delete('page');
    setParams(next);
  };

  const activeFilterCount = ['module_id', 'station_id', 'department_id', 'severity_id', 'status', 'q', 'from', 'to'].filter(
    (k) => params.get(k)
  ).length;

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Observations</h1>
        <p>{page ? `${page.total} record${page.total === 1 ? '' : 's'}` : 'Loading'}</p>
      </div>

      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          patch({ q: term || undefined });
        }}
      >
        <input
          className="input"
          placeholder="Search observation ID, text, station, supervisor..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button type="submit" icon="search" aria-label="Search" />
        <Button
          variant={activeFilterCount ? undefined : 'ghost'}
          icon="filter"
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Filters"
        >
          {activeFilterCount ? String(activeFilterCount) : ''}
        </Button>
        <Button
          variant={picking ? undefined : 'ghost'}
          icon="file"
          onClick={() => {
            setPicking((v) => !v);
            setPicked([]);
          }}
          aria-label="Compile an inspection note"
          title="Pick observations and compile them into one inspection note"
        />
      </form>

      {picking && (
        <Card pad>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <span className="small">
              {picked.length === 0
                ? 'Tick the observations that should go into one letter.'
                : `${picked.length} observation${picked.length === 1 ? '' : 's'} selected.`}
            </span>
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => setPicked([])} disabled={picked.length === 0}>
              Clear
            </Button>
            {picked.length > 0 ? (
              <Link className="btn btn--sm" to={`/notes/new?observations=${picked.join(',')}`}>
                <Icon name="file" size={13} /> Compile inspection note
              </Link>
            ) : (
              <Button size="sm" disabled icon="file">Compile inspection note</Button>
            )}
          </div>
        </Card>
      )}

      <div className="chips">
        {PRESETS.map((preset) => {
          const active = Object.entries(preset.params).every(([k, v]) => params.get(k) === v);
          return (
            <button
              key={preset.key}
              type="button"
              className={`chip${active ? ' chip--on' : ''}`}
              onClick={() => togglePreset(preset)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {showFilters && (
        <Card title="Filters" action={
          <Button size="sm" variant="ghost" onClick={() => setParams(new URLSearchParams())}>Clear all</Button>
        }>
          <div className="grid grid--3">
            <Field label="Module">
              <SearchSelect
                options={(masters?.modules ?? []).map((m) => ({ value: m.id, label: m.name }))}
                value={params.get('module_id') ? Number(params.get('module_id')) : null}
                onChange={(v) => patch({ module_id: v ? String(v) : undefined })}
                placeholder="All modules"
              />
            </Field>
            <Field label="Action by department">
              <SearchSelect
                options={(masters?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
                value={params.get('department_id') ? Number(params.get('department_id')) : null}
                onChange={(v) => patch({ department_id: v ? String(v) : undefined })}
                placeholder="All departments"
              />
            </Field>
            <Field label="Severity">
              <SearchSelect
                options={(masters?.severities ?? []).map((s) => ({ value: s.id, label: s.name }))}
                value={params.get('severity_id') ? Number(params.get('severity_id')) : null}
                onChange={(v) => patch({ severity_id: v ? String(v) : undefined })}
                placeholder="All severities"
              />
            </Field>
            <Field label="Status">
              <SearchSelect
                options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                value={params.get('status')}
                onChange={(v) => patch({ status: v ? String(v) : undefined })}
                placeholder="Any status"
              />
            </Field>
            <Field label="Observed from">
              <input
                className="input" type="date" value={params.get('from') ?? ''}
                onChange={(e) => patch({ from: e.target.value || undefined })}
              />
            </Field>
            <Field label="Observed to">
              <input
                className="input" type="date" value={params.get('to') ?? ''}
                onChange={(e) => patch({ to: e.target.value || undefined })}
              />
            </Field>
            <Field label="Sort by">
              <div className="select-wrap">
                <select className="select" value={params.get('sort') ?? 'newest'} onChange={(e) => patch({ sort: e.target.value })}>
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </Field>
          </div>
        </Card>
      )}

      {loading && !page ? (
        <Skeletons rows={5} height={116} />
      ) : !page || page.data.length === 0 ? (
        <Card>
          <EmptyState
            icon="list"
            title="No observations match this view"
            text="Adjust the filters, or record a new observation from the New Inspection screen."
          />
        </Card>
      ) : (
        <>
          <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            {page.data.map((o) =>
              picking ? (
                <label key={o.id} className="pick">
                  <input
                    type="checkbox"
                    checked={picked.includes(o.id)}
                    onChange={(e) =>
                      setPicked((list) => (e.target.checked ? [...list, o.id] : list.filter((id) => id !== o.id)))
                    }
                  />
                  <span style={{ flex: 1 }}>
                    <span className="row row--wrap" style={{ gap: 6 }}>
                      <span className="obs__ref">{o.ref_no}</span>
                      <Badge tone="outline">{o.department_name}</Badge>
                      {o.station_name && <span className="xsmall muted">{o.station_name}</span>}
                      {o.tdc && <span className="xsmall muted">TDC {o.tdc}</span>}
                    </span>
                    <span className="small clamp-2" style={{ display: 'block', marginTop: 3 }}>
                      {[o.unit_name, o.item_name].filter(Boolean).join(' · ')} — {o.observation}
                    </span>
                  </span>
                </label>
              ) : (
                <ObservationCard key={o.id} observation={o} />
              )
            )}
          </div>
          <Pager
            page={page.page}
            totalPages={page.total_pages}
            total={page.total}
            onPage={(next) => {
              patch({ page: String(next) });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </>
      )}

      {page && page.data.length > 0 && (
        <div className="center">
          {exportReport ? (
            <Button size="sm" variant="ghost" icon="download" onClick={() => exportReport?.('/reports/observations', query)}>
              Export this view to CSV
            </Button>
          ) : (
            <a
              className="btn btn--ghost btn--sm"
              href={reportUrl('/reports/observations', { ...query, format: 'xlsx' })}
            >
              <Icon name="download" size={14} /> Export this view to Excel
            </a>
          )}
        </div>
      )}
    </div>
  );
}
