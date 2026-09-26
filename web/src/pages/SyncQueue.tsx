import { useOffline } from '../state/OfflineContext';
import Icon from '../components/Icon';
import { Badge, Banner, Button, Card, EmptyState } from '../components/ui';
import { formatDateTime } from '../lib/format';

export default function SyncQueue() {
  const { queue, online, syncing, sync, discard } = useOffline();

  return (
    <div className="stack" style={{ '--gap': '13px' } as React.CSSProperties}>
      <div className="page-head">
        <h1>Pending sync</h1>
        <p>Work captured on this device that has not reached the server yet</p>
      </div>

      <Banner tone={online ? 'info' : 'warn'} icon={online ? 'cloud-up' : 'offline'}>
        {online
          ? 'This device is online. Anything waiting is uploaded automatically; you can also sync now.'
          : 'Offline - saved locally. Everything below will be uploaded automatically once connectivity returns.'}
      </Banner>

      {queue.length === 0 ? (
        <Card>
          <EmptyState icon="check" title="Nothing is waiting" text="All inspections and observations recorded on this device have been synced." />
        </Card>
      ) : (
        <>
          <Button icon="refresh" onClick={() => void sync()} loading={syncing} disabled={!online}>
            Sync {queue.length} item{queue.length === 1 ? '' : 's'} now
          </Button>
          <div className="stack" style={{ '--gap': '9px' } as React.CSSProperties}>
            {queue.map((item) => (
              <Card key={item.client_uuid} pad>
                <div className="row row--wrap" style={{ gap: 6, marginBottom: 5 }}>
                  <Badge tone={item.type === 'inspection' ? 'accent' : 'info'}>
                    {item.type === 'inspection' ? 'Inspection' : 'Observation'}
                  </Badge>
                  {!!item.photos && <Badge tone="outline"><Icon name="camera" size={11} /> {item.photos}</Badge>}
                  {item.error && <Badge tone="critical">Failed</Badge>}
                  <span className="spacer" />
                  <span className="xsmall muted">{formatDateTime(item.created_at)}</span>
                </div>
                <div className="small strong">{item.label}</div>
                {typeof item.payload.observation === 'string' && (
                  <div className="small muted clamp-2" style={{ marginTop: 3 }}>{item.payload.observation}</div>
                )}
                {item.error && (
                  <div className="small" style={{ color: 'var(--critical)', marginTop: 5 }}>
                    <Icon name="alert" size={12} /> {item.error}
                  </div>
                )}
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="spacer" />
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => void discard(item.client_uuid)}>
                    Discard
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
