import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      data-testid="pwa-offline-indicator"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-[#F59E0B]/40 bg-[#FFFBEB] px-3.5 py-2 text-xs font-semibold text-[#92400E] shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0 text-[#D97706]" />
      <span>Mode Offline — Data lokal &amp; cache tetap aktif</span>
    </div>
  );
};
