import { supabase } from '../lib/supabase';
import {
  enqueueOfflineCheckout,
  getPendingCheckouts,
  removePendingCheckout,
} from './offlineQueueService';

export interface CheckoutSyncResult {
  synced: boolean;
  queuedOffline: boolean;
  orderId: string;
  orderNumber?: string;
  errorMessage?: string;
}

export async function submitCheckoutAtomic(
  payload: Record<string, unknown>
): Promise<CheckoutSyncResult> {
  const orderId = String(payload.id || crypto.randomUUID());
  const normalizedPayload = { ...payload, id: orderId };

  // Jika browser offline, langsung simpan ke IndexedDB
  if (!navigator.onLine) {
    await enqueueOfflineCheckout(orderId, normalizedPayload, 'Perangkat sedang offline');
    return {
      synced: false,
      queuedOffline: true,
      orderId,
      orderNumber: `OFFLINE-${orderId.slice(0, 6).toUpperCase()}`,
    };
  }

  const { data, error } = await supabase.rpc('process_pos_checkout', {
    p_payload: normalizedPayload,
  });

  if (error) {
    // Jika gagal karena masalah jaringan, amankan ke antrean offline
    const isNetworkError =
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError');

    if (isNetworkError) {
      await enqueueOfflineCheckout(orderId, normalizedPayload, error.message);
      return {
        synced: false,
        queuedOffline: true,
        orderId,
        orderNumber: `OFFLINE-${orderId.slice(0, 6).toUpperCase()}`,
        errorMessage: error.message,
      };
    }

    // Jika error validasi bisnis (stok habis / voucher invalid), jangan antrekan
    return {
      synced: false,
      queuedOffline: false,
      orderId,
      errorMessage: error.message,
    };
  }

  return {
    synced: true,
    queuedOffline: false,
    orderId: data?.order_id || orderId,
    orderNumber: data?.order_number,
  };
}

export async function flushOfflineCheckoutQueue(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  if (!navigator.onLine) return { syncedCount: 0, failedCount: 0 };

  const pending = await getPendingCheckouts();
  let syncedCount = 0;
  let failedCount = 0;

  for (const item of pending) {
    const { error } = await supabase.rpc('process_pos_checkout', {
      p_payload: item.payload,
    });
    if (!error) {
      await removePendingCheckout(item.id);
      syncedCount++;
    } else {
      failedCount++;
    }
  }

  return { syncedCount, failedCount };
}
