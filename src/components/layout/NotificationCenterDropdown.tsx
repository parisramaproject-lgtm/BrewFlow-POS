import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  ClipboardCheck,
  MessageSquare,
  PackagePlus,
  Send,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showDevicePushNotification,
  type NotificationPermissionState,
} from '../../services/pwaNotificationService';
import type { AppNotification, PageId, UserRole } from '../../types';
import {
  countUnreadForRole,
  isNotificationVisibleForRole,
} from '../../utils/operationalNotifications';
import { canAccessPage } from '../../utils/rbac';

interface NotificationCenterDropdownProps {
  onNavigate: (page: PageId) => void;
  onClose: () => void;
}

type PanelMode = 'feed' | 'send_message' | 'request_restock';
type FeedFilter = 'all' | 'orders' | 'stock' | 'messages';

export function NotificationCenterDropdown({
  onNavigate,
  onClose,
}: NotificationCenterDropdownProps) {
  const { user } = useAuth();
  const {
    inventory,
    notifications,
    restockRequests,
    sendOperationalMessage,
    submitRestockRequest,
    updateRestockRequestStatus,
    markNotificationRead,
    markAllNotificationsRead,
  } = useStore();

  const [mode, setMode] = useState<PanelMode>('feed');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getBrowserNotificationPermission()
  );
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Owner -> Cashier message draft
  const [msgTarget, setMsgTarget] = useState<'cashier' | 'manager' | 'all'>('cashier');
  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');

  // Cashier -> Owner restock request draft
  const consumableInventory = useMemo(
    () => inventory.filter((item) => item.category_type !== 'asset'),
    [inventory]
  );
  const [restockItemId, setRestockItemId] = useState<string>(
    () =>
      consumableInventory.find((i) => i.current_stock <= i.min_stock_threshold)?.id ??
      consumableInventory[0]?.id ??
      ''
  );
  const [restockQty, setRestockQty] = useState<string>('500');
  const [restockUrgency, setRestockUrgency] = useState<'normal' | 'urgent'>('urgent');
  const [restockNote, setRestockNote] = useState<string>('');

  if (!user) return null;

  const isOwnerOrManager = user.role === 'owner' || user.role === 'manager';

  const roleNotifications = notifications.filter((n) => isNotificationVisibleForRole(n, user.role));
  const unreadCount = countUnreadForRole(notifications, user.role);

  const filteredNotifications = roleNotifications.filter((n) => {
    if (feedFilter === 'all') return true;
    if (feedFilter === 'orders') return n.type === 'new_order';
    if (feedFilter === 'stock')
      return n.type === 'low_stock' || n.type === 'restock_request' || n.type === 'purchase' || n.type === 'opname';
    if (feedFilter === 'messages') return n.type === 'owner_message' || n.type === 'info';
    return true;
  });

  const selectedRestockItem = consumableInventory.find((i) => i.id === restockItemId);

  const handleEnablePush = async () => {
    const next = await requestBrowserNotificationPermission();
    setPermission(next);
    if (next === 'granted') {
      await showDevicePushNotification({
        title: 'BrewFlow POS — Notifikasi Aktif',
        body: 'Perangkat Anda kini menerima notifikasi stok, orderan masuk, restock, dan pesan operasional.',
        tag: 'brewflow-push-enabled',
        playSound: true,
      });
      setActionFeedback('Notifikasi perangkat berhasil diaktifkan.');
    } else if (next === 'denied') {
      setActionFeedback('Izin notifikasi ditolak browser. Aktifkan melalui pengaturan situs browser.');
    }
  };

  const handleSendOwnerMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    const targetRoles: UserRole[] =
      msgTarget === 'all'
        ? ['cashier', 'manager', 'owner']
        : msgTarget === 'manager'
          ? ['manager', 'owner']
          : ['cashier', 'owner'];
    sendOperationalMessage({
      title:
        msgTitle.trim() ||
        (user.role === 'owner' ? 'Pesan dari Owner' : `Pesan dari ${user.full_name}`),
      message: msgBody.trim(),
      type: 'owner_message',
      targetRoles,
      targetPage: 'pos',
      senderName: user.full_name,
      senderRole: user.role,
    });
    setMsgTitle('');
    setMsgBody('');
    setMode('feed');
    setActionFeedback('Pesan berhasil dikirim ke perangkat penerima.');
    window.setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleSubmitRestock = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(restockQty);
    if (!restockItemId || !qty || qty <= 0) return;
    submitRestockRequest({
      inventory_item_id: restockItemId,
      requested_quantity: qty,
      urgency: restockUrgency,
      notes: restockNote,
      requested_by_id: user.id,
      requested_by_name: user.full_name,
      requested_by_role: user.role,
    });
    setRestockNote('');
    setMode('feed');
    setActionFeedback('Permintaan restock berhasil dikirim ke perangkat Owner & Manager.');
    window.setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleClickNotif = (notif: AppNotification) => {
    markNotificationRead(notif.id);
    if (canAccessPage(user.role, notif.targetPage)) {
      onNavigate(notif.targetPage);
      onClose();
    } else if (notif.type === 'low_stock') {
      setMode('request_restock');
    }
  };

  const renderIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'new_order':
        return {
          bg: 'bg-[#E6F5EE] text-[#109A58]',
          icon: <ShoppingBag className="h-4 w-4" />,
        };
      case 'owner_message':
        return {
          bg: 'bg-[#EFF6FF] text-[#2563EB]',
          icon: <MessageSquare className="h-4 w-4" />,
        };
      case 'restock_request':
        return {
          bg: 'bg-[#FFFBEB] text-[#D97706]',
          icon: <PackagePlus className="h-4 w-4" />,
        };
      case 'purchase':
        return {
          bg: 'bg-[#E6F5EE] text-[#059669]',
          icon: <Truck className="h-4 w-4" />,
        };
      case 'opname':
        return {
          bg: 'bg-[#FEF2F2] text-[#EF4444]',
          icon: <ClipboardCheck className="h-4 w-4" />,
        };
      default:
        return {
          bg: 'bg-[#FEF2F2] text-[#EF4444]',
          icon: <AlertTriangle className="h-4 w-4" />,
        };
    }
  };

  return (
    <div
      role="region"
      aria-label="Pusat Notifikasi Operasional"
      data-testid="notification-center-panel"
      className="absolute right-0 top-12 z-40 w-[340px] rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl sm:w-[420px]"
    >
      {/* Header */}
      <div className="border-b border-[#E5E7EB] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#1A2E26]">Pusat Notifikasi Operasional</h3>
            <p className="text-[11px] text-[#6B7280] tabular-nums">
              {unreadCount} belum dibaca · {roleNotifications.length} total
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllNotificationsRead(user.role)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#109A58] hover:bg-[#E6F5EE]"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Tandai dibaca</span>
            </button>
          )}
        </div>

        {/* Browser/PWA Push Permission Strip */}
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#F4F6F5] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            {permission === 'granted' ? (
              <BellRing className="h-3.5 w-3.5 shrink-0 text-[#109A58]" />
            ) : (
              <BellOff className="h-3.5 w-3.5 shrink-0 text-[#D97706]" />
            )}
            <span className="truncate font-medium text-[#1A2E26]">
              {permission === 'granted'
                ? 'Notifikasi perangkat aktif'
                : permission === 'denied'
                  ? 'Izin notifikasi diblokir browser'
                  : 'Notifikasi perangkat belum aktif'}
            </span>
          </div>
          {permission === 'granted' ? (
            <button
              type="button"
              onClick={() =>
                void showDevicePushNotification({
                  title: 'BrewFlow POS — Tes Notifikasi',
                  body: 'Notifikasi perangkat berfungsi dengan baik untuk operasional kedai.',
                  tag: `test-${Date.now()}`,
                  playSound: true,
                })
              }
              className="shrink-0 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58]"
            >
              Tes Notif
            </button>
          ) : permission !== 'unsupported' ? (
            <button
              type="button"
              data-testid="enable-device-push-btn"
              onClick={() => void handleEnablePush()}
              className="shrink-0 rounded-lg bg-[#109A58] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0D8A4E]"
            >
              Aktifkan
            </button>
          ) : null}
        </div>

        {/* Action Switcher: Feed / Owner->Cashier Message / Cashier->Owner Restock Request */}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:flex sm:items-center">
          <button
            type="button"
            onClick={() => setMode('feed')}
            className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              mode === 'feed'
                ? 'bg-[#E6F5EE] text-[#109A58]'
                : 'bg-[#F4F6F5] text-[#6B7280] hover:text-[#1A2E26]'
            }`}
          >
            Semua Info
          </button>
          {isOwnerOrManager && (
            <button
              type="button"
              data-testid="notif-compose-message-tab"
              onClick={() => setMode('send_message')}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                mode === 'send_message'
                  ? 'bg-[#EFF6FF] text-[#2563EB]'
                  : 'bg-[#F4F6F5] text-[#6B7280] hover:text-[#1A2E26]'
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              <span>Pesan ke Kasir</span>
            </button>
          )}
          <button
            type="button"
            data-testid="notif-restock-request-tab"
            onClick={() => setMode('request_restock')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              mode === 'request_restock'
                ? 'bg-[#FFFBEB] text-[#B45309]'
                : 'bg-[#F4F6F5] text-[#6B7280] hover:text-[#1A2E26]'
            }`}
          >
            <PackagePlus className="h-3 w-3" />
            <span>Ajukan Restock</span>
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div
          role="status"
          className="mx-3 mt-2.5 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-3 py-2 text-[11px] font-semibold text-[#109A58]"
        >
          {actionFeedback}
        </div>
      )}

      {/* MODE 1: Feed */}
      {mode === 'feed' && (
        <div className="p-2">
          <div className="mb-2 flex items-center gap-1 px-1">
            {(
              [
                { id: 'all', label: 'Semua' },
                { id: 'orders', label: 'Orderan' },
                { id: 'stock', label: 'Stok & Restock' },
                { id: 'messages', label: 'Pesan' },
              ] as Array<{ id: FeedFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFeedFilter(tab.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                  feedFilter === tab.id
                    ? 'bg-[#1A2E26] text-white'
                    : 'text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredNotifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[#6B7280]">
              <Bell className="mx-auto mb-2 h-6 w-6 text-[#9CA3AF]" />
              Tidak ada notifikasi pada kategori ini.
            </div>
          ) : (
            <div className="max-h-80 divide-y divide-[#E5E7EB] overflow-y-auto">
              {filteredNotifications.map((notif) => {
                const style = renderIcon(notif.type);
                const linkedReq = notif.restockRequestId
                  ? restockRequests.find((r) => r.id === notif.restockRequestId)
                  : undefined;

                return (
                  <div
                    key={notif.id}
                    className={`px-3 py-3 transition-colors ${
                      notif.unread ? 'bg-[#F4FBF7]/70' : 'bg-white'
                    } hover:bg-[#F4F6F5]`}
                  >
                    <button
                      type="button"
                      onClick={() => handleClickNotif(notif)}
                      className="flex w-full items-start gap-3 text-left"
                    >
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.bg}`}
                      >
                        {style.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold text-[#1A2E26]">{notif.title}</p>
                          <span className="shrink-0 text-[10px] text-[#6B7280]">
                            {notif.timestamp}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-[#6B7280]">
                          {notif.message}
                        </p>
                      </div>
                      {notif.unread && (
                        <span
                          aria-label="Belum dibaca"
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#109A58]"
                        />
                      )}
                    </button>

                    {/* Owner / Manager quick action on Cashier Restock Request */}
                    {isOwnerOrManager && linkedReq && linkedReq.status === 'pending' && (
                      <div className="mt-2 flex items-center justify-end gap-2 pl-11">
                        <button
                          type="button"
                          onClick={() => {
                            updateRestockRequestStatus(linkedReq.id, 'ordered', user.full_name);
                            markNotificationRead(notif.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#109A58]/35 bg-[#E6F5EE] px-2.5 py-1 text-[11px] font-semibold text-[#109A58] hover:bg-[#109A58] hover:text-white"
                        >
                          <Check className="h-3 w-3" />
                          <span>Tandai Diproses</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            markNotificationRead(notif.id);
                            onNavigate('purchasing');
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#109A58] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0D8A4E]"
                        >
                          <Truck className="h-3 w-3" />
                          <span>Buka Pembelian</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODE 2: Owner/Manager Send Message to Cashier */}
      {mode === 'send_message' && isOwnerOrManager && (
        <form onSubmit={handleSendOwnerMessage} className="space-y-3 p-4">
          <div>
            <label htmlFor="ops-msg-target" className="block text-xs font-semibold text-[#1A2E26]">
              Tujuan Penerima
            </label>
            <select
              id="ops-msg-target"
              value={msgTarget}
              onChange={(e) => setMsgTarget(e.target.value as 'cashier' | 'manager' | 'all')}
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              <option value="cashier">Kasir / Barista</option>
              <option value="manager">Manager Shift</option>
              <option value="all">Semua Staf Kedai</option>
            </select>
          </div>
          <div>
            <label htmlFor="ops-msg-title" className="block text-xs font-semibold text-[#1A2E26]">
              Judul Instruksi / Pesan
            </label>
            <input
              id="ops-msg-title"
              type="text"
              value={msgTitle}
              onChange={(e) => setMsgTitle(e.target.value)}
              placeholder="Misal: Promo Rush Hour Sore / Cek Stok Susu"
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="ops-msg-body" className="block text-xs font-semibold text-[#1A2E26]">
              Isi Pesan ke Kasir *
            </label>
            <textarea
              id="ops-msg-body"
              rows={3}
              required
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              placeholder="Tulis instruksi operasional untuk kasir..."
              className="mt-1 w-full rounded-xl border border-[#E5E7EB] p-2.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            data-testid="notif-send-message-submit"
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#109A58] text-xs font-semibold text-white hover:bg-[#0D8A4E]"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Kirim Notifikasi Pesan</span>
          </button>
        </form>
      )}

      {/* MODE 3: Request Restock / Purchase to Owner */}
      {mode === 'request_restock' && (
        <form onSubmit={handleSubmitRestock} className="space-y-3 p-4">
          <p className="text-[11px] leading-relaxed text-[#6B7280]">
            Ajukan permintaan pembelian/restock barang agar langsung masuk ke notifikasi perangkat{' '}
            <strong>Owner &amp; Manager</strong>.
          </p>
          <div>
            <label
              htmlFor="ops-restock-item"
              className="block text-xs font-semibold text-[#1A2E26]"
            >
              Bahan Baku / Kemasan *
            </label>
            <select
              id="ops-restock-item"
              value={restockItemId}
              onChange={(e) => setRestockItemId(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              {consumableInventory.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.name} (Sisa: {inv.current_stock} {inv.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label
                htmlFor="ops-restock-qty"
                className="block text-xs font-semibold text-[#1A2E26]"
              >
                Jumlah ({selectedRestockItem?.unit ?? 'unit'}) *
              </label>
              <input
                id="ops-restock-qty"
                type="number"
                min={1}
                required
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="ops-restock-urgency"
                className="block text-xs font-semibold text-[#1A2E26]"
              >
                Prioritas
              </label>
              <select
                id="ops-restock-urgency"
                value={restockUrgency}
                onChange={(e) => setRestockUrgency(e.target.value as 'normal' | 'urgent')}
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              >
                <option value="urgent">Mendesak (Segera Habis)</option>
                <option value="normal">Normal (Restock Rutin)</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="ops-restock-note"
              className="block text-xs font-semibold text-[#1A2E26]"
            >
              Catatan untuk Owner
            </label>
            <input
              id="ops-restock-note"
              type="text"
              value={restockNote}
              onChange={(e) => setRestockNote(e.target.value)}
              placeholder="Misal: Untuk shift sore, permintaan sedang tinggi"
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            data-testid="notif-restock-submit"
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#109A58] text-xs font-semibold text-white hover:bg-[#0D8A4E]"
          >
            <PackagePlus className="h-3.5 w-3.5" />
            <span>Kirim Permintaan Restock ke Owner</span>
          </button>
        </form>
      )}
    </div>
  );
}
