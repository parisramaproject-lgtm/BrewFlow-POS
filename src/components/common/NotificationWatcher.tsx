import { useEffect, useRef, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import {
  buildLowStockPayload,
  buildOpnameReminderPayload,
} from '../../services/whatsappService';
import { showDevicePushNotification } from '../../services/pwaNotificationService';
import type { AppNotification } from '../../types';
import { isNotificationVisibleForRole } from '../../utils/operationalNotifications';

/**
 * NotificationWatcher
 * Background operational monitor mounted inside AppLayout:
 * 1. Polls active Stock Opname schedules every 60s (and fetches from Supabase when live).
 * 2. Automatically triggers deduplicated WhatsApp push reminders (via Edge Function)
 *    for newly due Stock Opname schedules and newly detected low-stock items.
 * 3. Dispatches live OS/PWA device push notifications + subtle in-app toast alerts
 *    whenever new role-targeted operational events arrive (incoming orders, owner-to-cashier
 *    messages, cashier restock requests, depleted/low stock, and purchases).
 */
export function NotificationWatcher() {
  const { user, authMode } = useAuth();
  const {
    settings,
    notifications,
    dueOpnameSchedules,
    lowStockItems,
    refreshOpnameWatcher,
    sendWhatsAppMessage,
  } = useStore();

  const liveSupabaseEnabled = authMode === 'supabase';
  const notifiedScheduleIdsRef = useRef<Set<string>>(new Set());
  const notifiedLowStockSignatureRef = useRef<string>('');
  const seenNotificationIdsRef = useRef<Set<string> | null>(null);
  const [liveToast, setLiveToast] = useState<AppNotification | null>(null);

  // Periodic schedule evaluation & Supabase sync every 60 seconds
  useEffect(() => {
    if (!user) return;
    void refreshOpnameWatcher(liveSupabaseEnabled);

    const intervalId = window.setInterval(() => {
      void refreshOpnameWatcher(liveSupabaseEnabled);
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [user, liveSupabaseEnabled, refreshOpnameWatcher]);

  // Real-time OS/PWA Push & In-App Toast for newly arriving role-targeted notifications
  useEffect(() => {
    if (!user) return;
    const roleNotifications = notifications.filter((n) =>
      isNotificationVisibleForRole(n, user.role)
    );

    // Seed already-existing notification IDs on initial mount so we don't spam on page load
    if (seenNotificationIdsRef.current === null) {
      seenNotificationIdsRef.current = new Set(roleNotifications.map((n) => n.id));
      return;
    }

    const newlyArrived = roleNotifications.filter(
      (n) => n.unread && !seenNotificationIdsRef.current!.has(n.id)
    );

    if (newlyArrived.length === 0) return;

    for (const item of newlyArrived) {
      seenNotificationIdsRef.current.add(item.id);
    }

    const latest = newlyArrived[0];
    setLiveToast(latest);

    void showDevicePushNotification({
      title: `BrewFlow POS · ${latest.title}`,
      body: latest.message,
      tag: latest.id,
      playSound: true,
    });

    const hideTimer = window.setTimeout(() => {
      setLiveToast((current) => (current?.id === latest.id ? null : current));
    }, 6000);

    return () => window.clearTimeout(hideTimer);
  }, [notifications, user]);

  // Automatic WhatsApp reminder for due Stock Opname schedules (Owner & Manager)
  useEffect(() => {
    if (!user || !settings.whatsappAutoOpnameReminder) return;
    if (user.role === 'cashier') return;

    const targets = [settings.whatsappManagerPhone, settings.whatsappOwnerPhone].filter(Boolean);
    if (targets.length === 0) return;

    for (const schedule of dueOpnameSchedules) {
      if (notifiedScheduleIdsRef.current.has(schedule.id)) continue;
      notifiedScheduleIdsRef.current.add(schedule.id);

      void sendWhatsAppMessage({
        eventType: 'opname_reminder',
        targets,
        data: buildOpnameReminderPayload(schedule),
        enableSupabaseSync: liveSupabaseEnabled,
      });
    }
  }, [
    user,
    dueOpnameSchedules,
    settings.whatsappAutoOpnameReminder,
    settings.whatsappManagerPhone,
    settings.whatsappOwnerPhone,
    liveSupabaseEnabled,
    sendWhatsAppMessage,
  ]);

  // Automatic WhatsApp alert when low-stock set changes
  useEffect(() => {
    if (!user || !settings.whatsappAutoLowStock || lowStockItems.length === 0) return;
    if (user.role === 'cashier') return;

    const signature = lowStockItems
      .map((i) => `${i.id}:${i.current_stock}`)
      .sort()
      .join('|');

    if (signature === notifiedLowStockSignatureRef.current) return;
    notifiedLowStockSignatureRef.current = signature;

    const targets = [settings.whatsappOwnerPhone, settings.whatsappManagerPhone].filter(Boolean);
    if (targets.length === 0) return;

    void sendWhatsAppMessage({
      eventType: 'low_stock_alert',
      targets,
      data: buildLowStockPayload(lowStockItems),
      enableSupabaseSync: liveSupabaseEnabled,
    });
  }, [
    user,
    lowStockItems,
    settings.whatsappAutoLowStock,
    settings.whatsappOwnerPhone,
    settings.whatsappManagerPhone,
    liveSupabaseEnabled,
    sendWhatsAppMessage,
  ]);

  if (!liveToast) return null;

  return (
    <div
      role="status"
      data-testid="live-ops-toast"
      className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm items-start gap-3 rounded-2xl border border-[#109A58]/35 bg-[#FFFFFF] p-4 shadow-xl"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
        <BellRing className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-[#1A2E26]">{liveToast.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#6B7280]">{liveToast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => setLiveToast(null)}
        aria-label="Tutup notifikasi cepat"
        className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
