import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../state/AuthContext';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, Loading, Tabs } from '../components/ui';
import { formatDate, relativeTime, titleCase } from '../lib/format';
import type { Notification } from '../api/types';

const TONE: Record<string, string> = {
  CRITICAL_OBSERVATION: 'critical',
  OBSERVATION_OVERDUE: 'critical',
  OBSERVATION_ESCALATED: 'critical',
  COMPLIANCE_REJECTED: 'serious',
  TDC_DUE_TODAY: 'warning',
  TDC_REMINDER: 'warning',
  COMPLIANCE_SUBMITTED: 'info',
  OBSERVATION_CLOSED: 'good',
};

export default function Notifications() {
  const { setUnread } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ data: Notification[]; unread_count: number }>('/notifications', {
      unread: tab === 'unread' ? 'true' : undefined, limit: 80,
    })
      .then((r) => {
        setItems(r.data);
        setUnreadCount(r.unread_count);
        setUnread(r.unread_count);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [tab, setUnread]);

  useEffect(load, [load]);

  const markAll = async () => {
    await api.post('/notifications/read-all');
    load();
  };

  const open = async (n: Notification) => {
    if (!n.read_at) {
      await api.post(`/notifications/${n.id}/read`).catch(() => {});
      setUnread(Math.max(0, unreadCount - 1));
    }
  };

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="row">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1>Notifications</h1>
          <p>{unreadCount} unread</p>
        </div>
        <span className="spacer" />
        {unreadCount > 0 && <Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>}
      </div>

      <Tabs
        tabs={[{ key: 'unread', label: 'Unread', count: unreadCount }, { key: 'all', label: 'All' }]}
        value={tab}
        onChange={(key) => setTab(key as 'unread' | 'all')}
      />

      {loading && items.length === 0 ? (
        <Loading />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="bell"
            title={tab === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            text="Assignments, reminders, escalations, compliance submissions and closures all arrive here."
          />
        </Card>
      ) : (
        <div className="stack" style={{ '--gap': '9px' } as React.CSSProperties}>
          {items.map((n) => {
            const body = (
              <div
                className="card card--pad"
                style={{
                  borderLeft: `3px solid var(--${TONE[n.event] ?? 'accent'})`,
                  background: n.read_at ? 'var(--surface)' : 'var(--accent-soft)',
                }}
              >
                <div className="row row--wrap" style={{ gap: 6, marginBottom: 4 }}>
                  <Badge tone={TONE[n.event] ?? 'accent'}>{titleCase(n.event)}</Badge>
                  {!n.read_at && <Badge tone="info" dot>New</Badge>}
                  <span className="spacer" />
                  <span className="xsmall muted">{relativeTime(n.created_at)}</span>
                </div>
                <div className="small strong">{n.title}</div>
                {n.body && <div className="xsmall muted" style={{ whiteSpace: 'pre-line', marginTop: 3 }}>{n.body}</div>}
                <div className="obs__meta" style={{ marginTop: 6 }}>
                  {n.observation_ref && <span><b>{n.observation_ref}</b></span>}
                  {n.item_name && <span>{n.item_name}</span>}
                  {n.station_name && <span>{n.station_name}</span>}
                  {n.tdc && <span>TDC {formatDate(n.tdc)}</span>}
                  {n.delivery_status && <span><Icon name="send" size={11} /> {n.delivery_status}</span>}
                </div>
              </div>
            );
            return n.observation_id ? (
              <Link key={n.id} to={`/observations/${n.observation_id}`} onClick={() => void open(n)} style={{ textDecoration: 'none', color: 'inherit' }}>
                {body}
              </Link>
            ) : (
              <div key={n.id} onClick={() => void open(n)}>{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
