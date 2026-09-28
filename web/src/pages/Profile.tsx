import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import Icon from '../components/Icon';
import { Badge, Banner, Button, Card, Field, Loading } from '../components/ui';
import { formatDateTime, titleCase } from '../lib/format';

interface SessionRow {
  id: string; issued_at: string; expires_at: string; last_seen_at: string | null;
  ip: string | null; user_agent: string | null; revoked_at: string | null; current: boolean;
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.get<{ data: SessionRow[] }>('/auth/sessions').then((r) => setSessions(r.data)).catch(() => setSessions([]));
  };

  useEffect(load, []);

  if (!user) return <Loading />;

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('The new password and its confirmation do not match');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      toast.success('Password updated. Other sessions were signed out.');
      setCurrent('');
      setNext('');
      setConfirm('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Profile</h1>
        <p>Your account, access and active sessions</p>
      </div>

      <Card pad>
        <div className="row" style={{ gap: 12 }}>
          <span
            style={{
              width: 48, height: 48, borderRadius: 14, flex: 'none',
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'grid', placeItems: 'center', fontWeight: 700,
            }}
          >
            {user.name.split(' ').slice(0, 2).map((w) => w[0]).join('')}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '1rem' }}>{user.name}</h2>
            <div className="small muted">{user.designation}</div>
          </div>
        </div>
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>Employee ID</dt><dd className="mono-num">{user.employee_id}</dd>
          <dt>Role</dt><dd><Badge tone="accent">{titleCase(user.role)}</Badge></dd>
          <dt>Department</dt><dd>{user.department_name ?? '-'}</dd>
          <dt>Division</dt><dd>{user.division_name ?? 'All divisions'}</dd>
          <dt>Station</dt><dd>{user.station_name ?? '-'}</dd>
          <dt>Email</dt><dd>{user.email ?? '-'}</dd>
          <dt>Mobile</dt><dd>{user.mobile ?? '-'}</dd>
          {user.supervisor_id && (<><dt>Supervisor record</dt><dd>Linked - assigned observations reach you</dd></>)}
        </dl>
      </Card>

      {user.must_change_password && (
        <Banner tone="warn">Your password was issued by the administrator. Please change it now.</Banner>
      )}

      <Card title="Change password" icon="shield">
        <form onSubmit={changePassword}>
          {error && <div style={{ marginBottom: 10 }}><Banner tone="danger">{error}</Banner></div>}
          <Field label="Current password" required>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Field label="New password" required hint="At least 8 characters, with a letter and a digit">
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" required>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={busy}>Update password</Button>
        </form>
      </Card>

      <Card title="Active sessions" subtitle="Sessions time out automatically; you can end any of them here" icon="clock" pad={false}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Signed in</th><th>Last seen</th><th>Device</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="xsmall">{formatDateTime(s.issued_at)}</td>
                  <td className="xsmall">{s.last_seen_at ? formatDateTime(s.last_seen_at) : '-'}</td>
                  <td className="xsmall" style={{ maxWidth: 240 }}>
                    <span className="clamp-2">{s.user_agent ?? 'Unknown'}</span>
                    {s.ip && <div className="muted">{s.ip}</div>}
                  </td>
                  <td>
                    {s.current ? <Badge tone="good">This device</Badge>
                      : s.revoked_at ? <Badge tone="neutral">Signed out</Badge>
                        : new Date(s.expires_at) < new Date() ? <Badge tone="neutral">Expired</Badge>
                          : <Badge tone="info">Active</Badge>}
                  </td>
                  <td>
                    {!s.current && !s.revoked_at && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await api.del(`/auth/sessions/${s.id}`).catch(() => {});
                          load();
                        }}
                      >
                        End
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Button variant="ghost" icon="logout" onClick={() => void signOut()}>Sign out of this device</Button>

      <Card title="About this application" icon="info">
        <p className="small">
          Railway Inspection &amp; Compliance Management System for the Commercial Department. One inspection carries
          many observations; responsibility, notification, reminders, escalation, compliance, verification, closure and
          analytics are handled by the system.
        </p>
        <div className="row row--wrap" style={{ gap: 6, marginTop: 8 }}>
          <Badge tone="outline"><Icon name="offline" size={11} /> Works offline</Badge>
          <Badge tone="outline">Installable (PWA)</Badge>
          <Badge tone="outline">Role-based access</Badge>
          <Badge tone="outline">Full audit trail</Badge>
        </div>
      </Card>
    </div>
  );
}
