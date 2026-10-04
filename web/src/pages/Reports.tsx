import { useEffect, useMemo, useState } from 'react';
import { api, reportUrl } from '../api/client';
import { exportReport } from '../api/transport';
import { useAuth } from '../state/AuthContext';
import Icon from '../components/Icon';
import { Badge, Banner, Button, Card, Field, Loading, SearchSelect } from '../components/ui';
import { todayIso, addDays } from '../lib/format';
import type { Station } from '../api/types';

interface CatalogueEntry {
  key: string; name: string; path: string; description: string;
  /** Set when the report is of one entity and is opened from that entity's page. */
  entity?: string;
}

/** The reports whose unit is the inspection rather than the observation. */
const INSPECTION_REPORTS = ['inspection', 'inspection-register', 'inspector-wise'];

const FORMATS: { key: 'pdf' | 'xlsx' | 'csv'; label: string; icon: 'file' | 'download' }[] = [
  { key: 'pdf', label: 'PDF', icon: 'file' },
  { key: 'xlsx', label: 'Excel', icon: 'download' },
  { key: 'csv', label: 'CSV', icon: 'download' },
];

export default function Reports() {
  const { masters, can } = useAuth();
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(addDays(todayIso(), -90));
  const [to, setTo] = useState(todayIso());
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [stationId, setStationId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ key: string; title: string; rows: Record<string, unknown>[] } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ data: CatalogueEntry[] }>('/reports/catalogue'),
      api.get<{ data: Station[] }>('/masters/stations', { limit: 200 }),
    ])
      .then(([c, s]) => {
        setCatalogue(c.data);
        setStations(s.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const params = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      module_id: moduleId ?? undefined,
      station_id: stationId ?? undefined,
      department_id: departmentId ?? undefined,
    }),
    [from, to, moduleId, stationId, departmentId]
  );

  const runPreview = (entry: CatalogueEntry) => {
    if (entry.entity) return;
    setPreviewing(entry.key);
    api.get<{ title: string; count: number; data: Record<string, unknown>[] }>(`/reports/${entry.key}`, { ...params, format: 'json' })
      .then((r) => setPreview({ key: entry.key, title: r.title, rows: r.data.slice(0, 25) }))
      .catch(() => setPreview(null))
      .finally(() => setPreviewing(null));
  };

  /** One report in the catalogue: its formats and its preview. */
  const ReportCard = ({ entry }: { entry: CatalogueEntry }) => (
    <Card title={entry.name} subtitle={entry.description} icon="file">
      {entry.entity ? (
        <p className="small muted">
          Open any inspection and use its PDF or Excel button. The report carries the areas covered, the items found
          in order, the deficiencies with their target dates, the previous inspection's position, photographs,
          signatures and a QR code for verification.
        </p>
      ) : (
        <div className="row row--wrap" style={{ gap: 8 }}>
          {exportReport ? (
            <Button size="sm" variant="ghost" icon="download" onClick={() => exportReport?.(`/reports/${entry.key}`, params)}>
              CSV
            </Button>
          ) : (
            FORMATS.map((format) => (
              <a
                key={format.key}
                className="btn btn--ghost btn--sm"
                href={reportUrl(`/reports/${entry.key}`, { ...params, format: format.key })}
                target={format.key === 'pdf' ? '_blank' : undefined}
                rel="noreferrer"
              >
                <Icon name={format.icon} size={14} /> {format.label}
              </a>
            ))
          )}
          <Button size="sm" variant="quiet" loading={previewing === entry.key} onClick={() => runPreview(entry)}>
            Preview
          </Button>
        </div>
      )}
    </Card>
  );

  if (loading) return <Loading label="Loading reports" />;

  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Reports</h1>
        <p>Every report can be previewed here and exported as PDF, Excel or CSV</p>
      </div>

      <Card title="Filters" subtitle="Applied to every report below" icon="filter">
        <div className="grid grid--3">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Module">
            <SearchSelect
              options={(masters?.modules ?? []).map((m) => ({ value: m.id, label: m.name }))}
              value={moduleId}
              onChange={(v) => setModuleId(v as number | null)}
              placeholder="All modules"
            />
          </Field>
          <Field label="Station">
            <SearchSelect
              options={stations.map((s) => ({ value: s.id, label: `${s.name} (${s.code})`, keywords: s.code }))}
              value={stationId}
              onChange={(v) => setStationId(v as number | null)}
              placeholder="All stations"
              searchPlaceholder="Station name or code"
            />
          </Field>
          <Field label="Department">
            <SearchSelect
              options={(masters?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
              value={departmentId}
              onChange={(v) => setDepartmentId(v as number | null)}
              placeholder="All departments"
            />
          </Field>
        </div>
      </Card>

      {exportReport && (
        <Banner tone="info">
          This is the offline demonstration build. Reports can be previewed and exported as CSV from the data in this
          file; the PDF and Excel versions - with photographs, signatures and the verification QR code - are produced
          by the server in the deployed application.
        </Banner>
      )}

      {/* The inspection-based reports answer "was the inspecting done, and how much
          of each station did it cover"; the rest count observations. */}
      <div className="section-label" style={{ marginBottom: -6 }}>
        Based on the inspection
      </div>
      <div className="grid grid--wide">
        {catalogue.filter((e) => INSPECTION_REPORTS.includes(e.key)).map((entry) => (
          <ReportCard key={entry.key} entry={entry} />
        ))}
      </div>

      <div className="section-label" style={{ marginBottom: -6 }}>
        Based on the observations
      </div>
      <div className="grid grid--wide">
        {catalogue.filter((e) => !INSPECTION_REPORTS.includes(e.key)).map((entry) => (
          <ReportCard key={entry.key} entry={entry} />
        ))}
      </div>

      {can('admin', 'divisional_officer') && (
        <Card title="Audit trail export" subtitle="User, date, time, action, previous value and new value" icon="shield">
          <div className="row row--wrap" style={{ gap: 8 }}>
            {exportReport ? (
              <Button size="sm" variant="ghost" icon="download" onClick={() => exportReport?.('/reports/audit', params)}>
                CSV
              </Button>
            ) : (
              <>
                <a className="btn btn--ghost btn--sm" href={reportUrl('/reports/audit', { ...params, format: 'xlsx' })}>
                  <Icon name="download" size={14} /> Excel
                </a>
                <a className="btn btn--ghost btn--sm" href={reportUrl('/reports/audit', { ...params, format: 'csv' })}>
                  <Icon name="download" size={14} /> CSV
                </a>
              </>
            )}
          </div>
        </Card>
      )}

      {preview && (
        <Card
          title={`Preview: ${preview.title}`}
          subtitle={`First ${preview.rows.length} rows`}
          action={<Button size="sm" variant="quiet" onClick={() => setPreview(null)}>Close</Button>}
          pad={false}
        >
          {preview.rows.length === 0 ? (
            <div className="card__body"><p className="small muted">No data for these filters.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>{Object.keys(preview.rows[0] ?? {}).slice(0, 9).map((k) => <th key={k}>{k.replace(/_/g, ' ')}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i}>
                      {Object.keys(preview.rows[0] ?? {}).slice(0, 9).map((k) => (
                        <td key={k} className="xsmall">{formatCell(row[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Report verification" icon="qr">
        <p className="small">
          Every generated PDF carries a QR code. Scanning it opens a public verification page that confirms the report
          was produced by this system, by whom and when, and restates the inspection's figures.
        </p>
        <div className="row row--wrap" style={{ gap: 6, marginTop: 8 }}>
          <Badge tone="outline">Inspector acknowledgement</Badge>
          <Badge tone="outline">Supervisor acknowledgement</Badge>
          <Badge tone="outline">Officer approval</Badge>
          <Badge tone="outline">Digital signature</Badge>
          <Badge tone="outline">QR verification</Badge>
        </div>
      </Card>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value);
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}
