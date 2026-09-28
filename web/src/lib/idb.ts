/**
 * Minimal IndexedDB wrapper for offline support.
 *
 * Three stores:
 *   cache  - master-data snapshot and cached list responses
 *   queue  - observations/inspections captured while offline
 *   photos - evidence blobs waiting to be uploaded after sync
 */
const DB_NAME = 'railway-inspection';
const DB_VERSION = 1;

type StoreName = 'cache' | 'queue' | 'photos';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'client_uuid' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      const request = fn(store);
      tx.oncomplete = () => resolve(request ? (request.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Private windows and blocked storage must never break the application.
    return undefined;
  }
}

export const idb = {
  get: <T>(key: string) => withStore<T>('cache', 'readonly', (s) => s.get(key) as IDBRequest<T>),
  set: (key: string, value: unknown) => withStore('cache', 'readwrite', (s) => void s.put(value, key)),
  remove: (key: string) => withStore('cache', 'readwrite', (s) => void s.delete(key)),

  queueAll: <T>() => withStore<T[]>('queue', 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  queuePut: <T extends { client_uuid: string }>(item: T) =>
    withStore('queue', 'readwrite', (s) => void s.put(item)),
  queueRemove: (clientUuid: string) => withStore('queue', 'readwrite', (s) => void s.delete(clientUuid)),
  queueClear: () => withStore('queue', 'readwrite', (s) => void s.clear()),

  photoAdd: (record: { client_uuid: string; blob: Blob; name: string; caption?: string }) =>
    withStore('photos', 'readwrite', (s) => void s.add(record)),
  photosAll: <T>() =>
    withStore<T[]>('photos', 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  photoKeys: () => withStore<IDBValidKey[]>('photos', 'readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>),
  photoRemove: (key: IDBValidKey) => withStore('photos', 'readwrite', (s) => void s.delete(key)),
};

export default idb;
