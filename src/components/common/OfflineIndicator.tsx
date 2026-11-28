import React, { useState } from 'react';
import { CloudUpload, RefreshCw, WifiOff } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useOnlineStatus } from '../../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { pendingOfflineOrdersCount, isSyncingOfflineQueue, syncOfflineQueueNow } = useStore();
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  if (isOnline && pendingOfflineOrdersCount === 0 && !syncNotice) return null;

  const handleSyncNow = async () => {
    if (isSyncingOfflineQueue) return;
    const res = await syncOfflineQueueNow();
    if (res.syncedCount > 0 && res.remainingCount === 0) {
      setSyncNotice(`${res.syncedCount} transaksi offline berhasil disinkronkan ke Supabase.`);
      window.setTimeout(() => setSyncNotice(null), 4500);
    } else if (res.remainingCount > 0) {
      setSyncNotice(
        `${res.syncedCount} berhasil, ${res.remainingCount} transaksi masih menunggu koneksi stabil.`
      );
      window.setTimeout(() => setSyncNotice(null), 5000);
    }
  };

  if (!isOnline) {
    return (
      <div
        role="status"
        data-testid="pwa-offline-indicator"
        className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-2 rounded-2xl border border-[#F59E0B]/40 bg-[#FFFBEB] px-3.5 py-2.5 text-xs font-semibold text-[#92400E] shadow-lg sm:right-auto sm:rounded-full sm:py-2"
      >
        <WifiOff className="h-3.5 w-3.5 shrink-0 text-[#D97706]" />
        <span>
          Mode Offline
          {pendingOfflineOrdersCount > 0
            ? ` · ${pendingOfflineOrdersCount} transaksi di antrean lokal`
            : ' — Data lokal & cache tetap aktif'}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="pwa-offline-sync-indicator"
      className="fixed bottom-4 left-4 right-4 z-50 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#109A58]/35 bg-[#E6F5EE] px-4 py-2.5 text-xs font-semibold text-[#0D6E40] shadow-lg sm:right-auto sm:justify-start sm:rounded-full sm:py-2"
    >
      <CloudUpload className="h-4 w-4 shrink-0 text-[#109A58]" />
      <span>
        {syncNotice
          ? syncNotice
          : `${pendingOfflineOrdersCount} transaksi menunggu sinkronisasi ke Supabase`}
      </span>
      {pendingOfflineOrdersCount > 0 && (
        <button
          type="button"
          disabled={isSyncingOfflineQueue}
          onClick={() => void handleSyncNow()}
          className="inline-flex items-center gap-1 rounded-full bg-[#109A58] px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${isSyncingOfflineQueue ? 'animate-spin' : ''}`} />
          <span>{isSyncingOfflineQueue ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</span>
        </button>
      )}
    </div>
  );
};
