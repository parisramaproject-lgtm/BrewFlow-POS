import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueuePendingOrder,
  getPendingOrders,
  isLikelyNetworkFailure,
  markPendingOrderFailed,
  removePendingOrder,
  type QueuedOfflineOrder,
} from './offlineQueueService';

test('isLikelyNetworkFailure identifies network errors vs server validation errors', () => {
  assert.equal(isLikelyNetworkFailure('TypeError: Failed to fetch'), true);
  assert.equal(isLikelyNetworkFailure('NetworkError when attempting to fetch resource'), true);
  assert.equal(isLikelyNetworkFailure('ERR_INTERNET_DISCONNECTED'), true);
  assert.equal(isLikelyNetworkFailure('duplicate key value violates unique constraint'), false);
  assert.equal(isLikelyNetworkFailure('new row violates row-level security policy'), false);
});

test('offline queue enqueues, retries, and removes orders cleanly', async () => {
  // Mock minimal localStorage for Node test environment (no IndexedDB)
  const mem = new Map<string, string>();
  const prevWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
      removeItem: (k: string) => mem.delete(k),
    },
  };

  try {
    const entry: QueuedOfflineOrder = {
      localId: 'ord-offline-1',
      order: {
        id: 'ord-offline-1',
        order_number: 'BF-261127-001',
        cashier_id: 'emp-1',
        cashier_name: 'Kasir',
        customer_id: null,
        customer_name: null,
        order_type: 'takeaway',
        table_number: 'Takeaway',
        subtotal: 28000,
        discount_amount: 0,
        tax_amount: 2800,
        total_amount: 30800,
        payment_method: 'cash',
        status: 'completed',
        sync_status: 'pending_sync',
        notes: '',
        items: [],
        created_at: '2026-11-27T02:00:00Z',
      },
      updatedCustomer: null,
      deductions: [],
      pointsEarned: 0,
      queuedAt: '2026-11-27T02:00:00Z',
      retryCount: 0,
    };

    await enqueuePendingOrder(entry);
    let pending = await getPendingOrders();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].order.order_number, 'BF-261127-001');

    await markPendingOrderFailed('ord-offline-1', 'Failed to fetch');
    pending = await getPendingOrders();
    assert.equal(pending[0].retryCount, 1);
    assert.equal(pending[0].lastError, 'Failed to fetch');

    await removePendingOrder('ord-offline-1');
    pending = await getPendingOrders();
    assert.equal(pending.length, 0);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  }
});
