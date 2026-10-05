import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import ObservationCard from '../components/ObservationCard';
import { Card, EmptyState, Pager, Skeletons, Tabs } from '../components/ui';
import type { Observation, Paged } from '../api/types';

type Tab = 'queue' | 'verify' | 'register';

interface QueueResponse extends Paged<Observation> {
  buckets: Record<string, number>;
}

interface ComplianceRow {
  id: number; observation_id: number; observation_ref: string; round: number;
  action_taken: string; compliance_date: string; status: string;
  submitted_by_name: string; verified_by_name: string | null;
  station_name: string | null; unit_name: string | null; item_name: string | null;
  severity_name: string; observation_status: string; attachment_count: number;
}

export default function Compliance() {
  const { user, counters } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  const [tab, setTab] = useState<Tab>(isSupervisor ? 'queue' : 'verify');
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [verify, setVerify] = useState<Paged<Observation> | null>(null);
  const [register, setRegister] = useState<Paged<ComplianceRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    const done = () => setLoading(false);
    if (tab === 'queue') {
      api.get<QueueResponse>('/compliance/queue', { page, page_size: 20 }).then(setQueue).catch(() => setQueue(null)).finally(done);
    } else if (tab === 'verify') {
      api.get<Paged<Observation>>('/compliance/awaiting-verification', { page, page_size: 20, mine: false })
        .then(setVerify).catch(() => setVerify(null)).finally(done);
    } else {
      api.get<Paged<ComplianceRow>>('/compliance', { page, page_size: 20 })
        .then(setRegister).catch(() => setRegister(null)).finally(done);
    }
  }, [tab, page]);

  useEffect(load, [load]);

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Compliance</h1>
        <p>
          {isSupervisor
            ? 'Observations assigned to you, and the compliance you have submitted'
            : 'Compliance submitted by supervisors, awaiting your verification'}
        </p>
      </div>

      <Tabs
        tabs={[
          { key: 'queue', label: 'My queue', count: counters?.assigned_to_me },
          { key: 'verify', label: 'Awaiting verification', count: counters?.awaiting_verification },
          { key: 'register', label: 'Compliance register' },
        ]}
        value={tab}
        onChange={(key) => {
          setTab(key as Tab);
          setPage(1);
        }}
      />

      {tab === 'queue' && (
        <>
          {queue && (
            <div className="grid grid--4">
              {[
                ['To acknowledge', queue.buckets.to_acknowledge],
                ['In progress', queue.buckets.in_progress],
                ['Rejected / reopened', queue.buckets.rejected],
                ['Overdue', queue.buckets.overdue],
                ['Submitted', queue.buckets.submitted],
              ].map(([label, value]) => (
                <div className="tile" key={String(label)}>
                  <div className="tile__label">{label}</div>
                  <div className={`tile__value mono-num${label === 'Overdue' && Number(value) > 0 ? ' tile__value--alert' : ''}`}>
                    {Number(value ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {loading && !queue ? (
            <Skeletons rows={4} height={116} />
          ) : !queue || queue.data.length === 0 ? (
            <Card>
              <EmptyState
                icon="check"
                title="Nothing pending with you"
                text="Observations assigned to you appear here with their target date of compliance."
              />
            </Card>
          ) : (
            <>
              <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                {queue.data.map((o) => <ObservationCard key={o.id} observation={o} />)}
              </div>
              <Pager page={queue.page} totalPages={queue.total_pages} total={queue.total} onPage={setPage} />
            </>
          )}
        </>
      )}

      {tab === 'verify' && (
        <>
          {loading && !verify ? (
            <Skeletons rows={4} height={116} />
          ) : !verify || verify.data.length === 0 ? (
            <Card>
              <EmptyState
                icon="shield"
                title="Nothing awaiting verification"
                text="When a supervisor submits compliance, the observation appears here for you to accept, reject or mark for physical verification."
              />
            </Card>
          ) : (
            <>
              <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                {verify.data.map((o) => <ObservationCard key={o.id} observation={o} />)}
              </div>
              <Pager page={verify.page} totalPages={verify.total_pages} total={verify.total} onPage={setPage} />
            </>
          )}
        </>
      )}

      {tab === 'register' && (
        <Card pad={false}>
          {loading && !register ? (
            <div className="card__body"><Skeletons rows={5} height={40} /></div>
          ) : !register || register.data.length === 0 ? (
            <EmptyState icon="file" title="No compliance records yet" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Observation</th><th>Item / Unit</th><th>Round</th>
                      <th>Action taken</th><th>Date</th><th>Verification</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {register.data.map((row) => (
                      <tr key={row.id}>
                        <td><Link to={`/observations/${row.observation_id}`}>{row.observation_ref}</Link></td>
                        <td className="xsmall">
                          {row.item_name}
                          <div className="muted">{[row.unit_name, row.station_name].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="num">{row.round}</td>
                        <td className="xsmall" style={{ maxWidth: 320 }}>{row.action_taken}</td>
                        <td className="xsmall">{row.compliance_date}</td>
                        <td className="xsmall">
                          {row.status}
                          {row.verified_by_name && <div className="muted">{row.verified_by_name}</div>}
                        </td>
                        <td className="xsmall">{row.observation_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={register.page} totalPages={register.total_pages} total={register.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
