export interface QueuedCheckoutPayload {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

const DB_NAME = 'brewflow_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_checkouts';

function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueOfflineCheckout(
  id: string,
  payload: Record<string, unknown>,
  lastError?: string
): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry: QueuedCheckoutPayload = {
      id,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastError,
    };
    store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingCheckouts(): Promise<QueuedCheckoutPayload[]> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingCheckout(id: string): Promise<void> {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
