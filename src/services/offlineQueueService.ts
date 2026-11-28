import type { CartItem, Customer, OrderRecord } from '../types';
import type { StockDeductionSummary } from './posService';

export interface QueuedOfflineOrder {
  localId: string;
  order: OrderRecord;
  cartItems?: CartItem[];
  updatedCustomer: Customer | null;
  deductions: StockDeductionSummary[];
  voucherId?: string | null;
  voucherCode?: string | null;
  pointsEarned: number;
  queuedAt: string;
  retryCount: number;
  lastError?: string;
}

const DB_NAME = 'brewflow_offline_db_v1';
const STORE_NAME = 'pending_orders';
const FALLBACK_STORAGE_KEY = 'brewflow_pending_orders_fallback_v1';

function hasIndexedDb(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Gagal membuka IndexedDB.'));
  });
}

function readFallbackQueue(): QueuedOfflineOrder[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedOfflineOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFallbackQueue(items: QueuedOfflineOrder[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export async function enqueuePendingOrder(entry: QueuedOfflineOrder): Promise<void> {
  if (!hasIndexedDb()) {
    const existing = readFallbackQueue().filter((item) => item.localId !== entry.localId);
    writeFallbackQueue([...existing, entry]);
    return;
  }

  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan ke IndexedDB.'));
    });
    db.close();
  } catch {
    const existing = readFallbackQueue().filter((item) => item.localId !== entry.localId);
    writeFallbackQueue([...existing, entry]);
  }
}

export async function getPendingOrders(): Promise<QueuedOfflineOrder[]> {
  if (!hasIndexedDb()) {
    return readFallbackQueue().sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  try {
    const db = await openOfflineDb();
    const rows = await new Promise<QueuedOfflineOrder[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error ?? new Error('Gagal membaca antrean IndexedDB.'));
    });
    db.close();
    const fallback = readFallbackQueue();
    const merged = new Map<string, QueuedOfflineOrder>();
    for (const item of [...fallback, ...rows]) {
      merged.set(item.localId, item);
    }
    return Array.from(merged.values()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return readFallbackQueue().sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }
}

export async function removePendingOrder(localId: string): Promise<void> {
  writeFallbackQueue(readFallbackQueue().filter((item) => item.localId !== localId));

  if (!hasIndexedDb()) return;
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Gagal menghapus item IndexedDB.'));
    });
    db.close();
  } catch {
    // Non-blocking cleanup
  }
}

export async function markPendingOrderFailed(localId: string, errorMessage: string): Promise<void> {
  const all = await getPendingOrders();
  const target = all.find((item) => item.localId === localId);
  if (!target) return;
  await enqueuePendingOrder({
    ...target,
    retryCount: (target.retryCount || 0) + 1,
    lastError: errorMessage,
  });
}

export function isLikelyNetworkFailure(errorMessage: string | undefined): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('offline') ||
    lower.includes('timeout') ||
    lower.includes('err_internet_disconnected')
  );
}
