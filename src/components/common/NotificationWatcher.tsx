import { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import {
  buildLowStockPayload,
  buildOpnameReminderPayload,
} from '../../services/whatsappService';

/**
 * NotificationWatcher
 * Background operational monitor mounted inside AppLayout:
 * 1. Polls active Stock Opname schedules every 60s (and fetches from Supabase when live).
 * 2. Evaluates current time against daily/weekly/monthly opname schedules.
 * 3. Automatically triggers deduplicated WhatsApp push reminders (via Edge Function)
 *    for newly due Stock Opname schedules and newly detected low-stock items.
 */
export function NotificationWatcher() {
  const { user, authMode } = useAuth();
  const {
    settings,
    dueOpnameSchedules,
    lowStockItems,
    refreshOpnameWatcher,
    sendWhatsAppMessage,
  } = useStore();

  const liveSupabaseEnabled = authMode === 'supabase';
  const notifiedScheduleIdsRef = useRef<Set<string>>(new Set());
  const notifiedLowStockSignatureRef = useRef<string>('');

  // Periodic schedule evaluation & Supabase sync every 60 seconds
  useEffect(() => {
    if (!user) return;
    void refreshOpnameWatcher(liveSupabaseEnabled);

    const intervalId = window.setInterval(() => {
      void refreshOpnameWatcher(liveSupabaseEnabled);
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [user, liveSupabaseEnabled, refreshOpnameWatcher]);

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

  return null;
}
