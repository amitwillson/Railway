import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { api } from '../api/client';
import idb from '../lib/idb';
import { useToast } from './ToastContext';
import type { QueuedOperation } from '../api/types';

interface SyncResult {
  client_uuid: string;
  type: string;
  status: 'created' | 'duplicate' | 'failed';
  id?: number;
  ref_no?: string;
  error?: string;
  supervisor_name?: string;
  notification_recipients?: number;
}

interface OfflineState {
  online: boolean;
  queue: QueuedOperation[];
  syncing: boolean;
  lastSyncAt: string | null;
  /** Saves an operation for later upload and returns the queue length. */
  enqueue: (op: Omit<QueuedOperation, 'created_at'>, photos?: File[]) => Promise<number>;
  sync: (silent?: boolean) => Promise<void>;
  discard: (clientUuid: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const OfflineContext = createContext<OfflineState | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const items = (await idb.queueAll<QueuedOperation>()) ?? [];
    items.sort((a, b) => a.created_at.localeCompare(b.created_at));
    setQueue(items);
  }, []);

  useEffect(() => {
    void refresh();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [refresh]);

  const enqueue = useCallback(
    async (op: Omit<QueuedOperation, 'created_at'>, photos: File[] = []) => {
      const record: QueuedOperation = { ...op, created_at: new Date().toISOString(), photos: photos.length };
      await idb.queuePut(record);
      for (const photo of photos) {
        await idb.photoAdd({ client_uuid: op.client_uuid, blob: photo, name: photo.name || 'photo.jpg' });
      }
      const items = (await idb.queueAll<QueuedOperation>()) ?? [];
      setQueue(items.sort((a, b) => a.created_at.localeCompare(b.created_at)));
      return items.length;
    },
    []
  );

  /** Uploads photos captured offline once their observation exists on the server. */
  const uploadQueuedPhotos = useCallback(async (clientUuid: string, observationId: number) => {
    const keys = (await idb.photoKeys()) ?? [];
    const records = (await idb.photosAll<{ client_uuid: string; blob: Blob; name: string }>()) ?? [];
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const key = keys[i];
      if (!record || record.client_uuid !== clientUuid || key === undefined) continue;
      try {
        const form = new FormData();
        form.append('files', record.blob, record.name);
        form.append('phase', 'observation');
        await api.postForm(`/observations/${observationId}/attachments`, form);
        await idb.photoRemove(key);
      } catch {
        // Leave the photo queued; the next sync will retry it.
      }
    }
  }, []);

  const sync = useCallback(
    async (silent = false) => {
      const items = (await idb.queueAll<QueuedOperation>()) ?? [];
      if (items.length === 0) {
        if (!silent) toast.push('Nothing is waiting to be synced');
        return;
      }
      setSyncing(true);
      try {
        items.sort((a, b) => a.created_at.localeCompare(b.created_at));
        const operations = items.map((item) => ({
          type: item.type,
          client_uuid: item.client_uuid,
          ...(item.inspection_client_uuid ? { inspection_client_uuid: item.inspection_client_uuid } : {}),
          payload: item.payload,
        }));
        const response = await api.post<{ summary: Record<string, number>; results: SyncResult[] }>(
          '/sync/batch',
          { operations }
        );
        for (const result of response.results) {
          if (result.status === 'failed') {
            const item = items.find((i) => i.client_uuid === result.client_uuid);
            if (item) await idb.queuePut({ ...item, error: result.error });
            continue;
          }
          if (result.type === 'observation' && result.id) {
            await uploadQueuedPhotos(result.client_uuid, result.id);
          }
          await idb.queueRemove(result.client_uuid);
        }
        setLastSyncAt(new Date().toISOString());
        await refresh();
        const { created = 0, duplicates = 0, failed = 0 } = response.summary;
        if (failed > 0) {
          toast.warn(`Synced ${created}, ${failed} could not be synced - open Pending sync for details`);
        } else if (!silent || created > 0) {
          toast.success(
            `Successfully synced ${created} item${created === 1 ? '' : 's'}` +
              (duplicates ? ` (${duplicates} already on the server)` : '')
          );
        }
      } catch {
        if (!silent) toast.error('Sync failed. It will be retried when the connection is back.');
      } finally {
        setSyncing(false);
      }
    },
    [refresh, toast, uploadQueuedPhotos]
  );

  const discard = useCallback(
    async (clientUuid: string) => {
      await idb.queueRemove(clientUuid);
      await refresh();
      toast.push('Removed from the pending queue');
    },
    [refresh, toast]
  );

  // Sync automatically as soon as connectivity returns.
  useEffect(() => {
    if (online && queue.length > 0 && !syncing) {
      const timer = window.setTimeout(() => void sync(true), 1200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [online, queue.length, syncing, sync]);

  const value = useMemo<OfflineState>(
    () => ({ online, queue, syncing, lastSyncAt, enqueue, sync, discard, refresh }),
    [online, queue, syncing, lastSyncAt, enqueue, sync, discard, refresh]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside OfflineProvider');
  return ctx;
}
