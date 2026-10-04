import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import Icon from '../components/Icon';
import { Badge, Card, EmptyState, Pager, Skeletons, Tabs } from '../components/ui';
import { formatDate, moduleTone, relativeTime, titleCase } from '../lib/format';
import type { Inspection, Paged } from '../api/types';

export default function Inspections() {
  const { masters } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<Paged<Inspection> | null>(null);
  const [loading, setLoading] = useState(true);
  const scope = (params.get('scope') as 'mine' | 'all') ?? 'mine';

  const load = useCallback(() => {
    setLoading(true);
    api.get<Paged<Inspection>>('/inspections', {
      mine: scope === 'mine' ? 1 : undefined,
      module_id: params.get('module_id') ?? undefined,
      status: params.get('status') ?? undefined,
      q: params.get('q') ?? undefined,
      page: params.get('page') ?? undefined,
      page_size: 20,
    })
      .then(setPage)
      .catch(() => setPage(null))
      .finally(() => setLoading(false));
  }, [params, scope]);

  useEffect(load, [load]);

  const patch = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row" style={{ marginBottom: 2 }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1>Inspections</h1>
          <p>{page ? `${page.total} inspection${page.total === 1 ? '' : 's'}` : 'Loading'}</p>
        </div>
        <span className="spacer" />
        <Link to="/inspections/new" className="btn btn--sm"><Icon name="plus" size={15} /> New</Link>
      </div>

      <Tabs
        tabs={[{ key: 'mine', label: 'My inspections' }, { key: 'all', label: 'All inspections' }]}
        value={scope}
        onChange={(key) => patch({ scope: key, page: undefined })}
      />

      <div className="chips">
        <button className={`chip${!params.get('module_id') ? ' chip--on' : ''}`} onClick={() => patch({ module_id: undefined, page: undefined })}>
          All modules
        </button>
        {(masters?.modules ?? []).map((m) => (
          <button
            key={m.id}
            className={`chip${params.get('module_id') === String(m.id) ? ' chip--on' : ''}`}
            onClick={() => patch({ module_id: String(m.id), page: undefined })}
          >
            {m.name}
          </button>
        ))}
        <button
          className={`chip${params.get('status') === 'in_progress' ? ' chip--on' : ''}`}
          onClick={() => patch({ status: params.get('status') === 'in_progress' ? undefined : 'in_progress', page: undefined })}
        >
          In progress
        </button>
      </div>

      {loading && !page ? (
        <Skeletons rows={4} height={104} />
      ) : !page || page.data.length === 0 ? (
        <Card>
          <EmptyState
            icon="clipboard"
            title="No inspections yet"
            text="Start an inspection - pick the module, the station or train, and record your observations."
            action={<Link to="/inspections/new" className="btn">New Inspection</Link>}
          />
        </Card>
      ) : (
        <>
          <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            {page.data.map((i) => (
              <Link
                key={i.id}
                to={`/inspections/${i.id}`}
                className="obs"
                style={{ '--tone': `var(--mod-${moduleTone(i.module_accent)})` } as React.CSSProperties}
              >
                <div className="obs__top">
                  <span className="obs__ref">{i.ref_no}</span>
                  <Badge tone={i.status === 'completed' ? 'good' : i.status === 'cancelled' ? 'neutral' : 'warning'}>
                    {titleCase(i.status)}
                  </Badge>
                  <Badge tone={moduleTone(i.module_accent)}>{i.module_code}</Badge>
                  {i.critical_count > 0 && <Badge tone="critical">{i.critical_count} critical</Badge>}
                  <span className="spacer" />
                  <span className="xsmall muted">{relativeTime(i.started_at ?? i.created_at)}</span>
                </div>
                <div className="small strong">{i.inspection_type_name}</div>
                <div className="obs__meta" style={{ marginTop: 4 }}>
                  <span>
                    <Icon name={i.train_id ? 'train' : 'station'} size={11} />{' '}
                    <b>
                      {i.station_name ? `${i.station_name} (${i.station_code})` : [i.train_number, i.train_name].filter(Boolean).join(' ') || i.section || '-'}
                    </b>
                  </span>
                  <span><Icon name="user" size={11} /> {i.inspector_name}</span>
                  <span>{formatDate(i.started_at ?? i.created_at)}</span>
                  {i.from_time && <span>{i.from_time}{i.to_time ? `-${i.to_time}` : ''}</span>}
                  {i.inspection_no && <span className="strong">{i.inspection_no}</span>}
                </div>
                {/* How much of the place this visit covered. It is the first thing
                    worth knowing about an inspection; the deficiencies follow. */}
                {i.areas_on_sheet > 0 && (
                  <div className="coverage__bar" style={{ marginTop: 8 }} aria-hidden="true">
                    <span className="coverage__fill" style={{ width: `${Math.min(100, i.coverage_pct ?? 0)}%` }} />
                  </div>
                )}
                <div className="row row--wrap" style={{ gap: 12, marginTop: 7 }}>
                  {i.areas_on_sheet > 0 && (
                    <span className="xsmall">
                      <b className="mono-num">{i.areas_covered}</b>
                      <span className="muted">/{i.areas_on_sheet - i.areas_not_available} areas</span>
                      {i.coverage_pct != null && <span className="muted"> ({i.coverage_pct}%)</span>}
                    </span>
                  )}
                  {i.items_checked > 0 && (
                    <span className="xsmall"><b className="mono-num">{i.items_checked}</b> <span className="muted">items checked</span></span>
                  )}
                  <span className="xsmall"><b className="mono-num">{i.observation_count}</b> <span className="muted">deficiencies</span></span>
                  <span className="xsmall"><b className="mono-num">{i.open_count}</b> <span className="muted">open</span></span>
                </div>
              </Link>
            ))}
          </div>
          <Pager page={page.page} totalPages={page.total_pages} total={page.total} onPage={(n) => patch({ page: String(n) })} />
        </>
      )}
    </div>
  );
}
