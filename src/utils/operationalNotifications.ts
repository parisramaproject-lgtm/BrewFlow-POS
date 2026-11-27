import type { AppNotification, UserRole, VendorRecord } from '../types';

/**
 * Checks whether a given operational notification should be displayed for the active role.
 */
export function isNotificationVisibleForRole(
  notification: AppNotification,
  role: UserRole
): boolean {
  if (!notification.targetRoles || notification.targetRoles.length === 0) {
    return true;
  }
  return notification.targetRoles.includes(role);
}

/**
 * Counts unread notifications visible to the active role.
 */
export function countUnreadForRole(
  notifications: AppNotification[],
  role: UserRole
): number {
  return notifications.filter(
    (notif) => notif.unread && isNotificationVisibleForRole(notif, role)
  ).length;
}

/**
 * Normalizes an Indonesian phone/WhatsApp number to digits starting with 62 for wa.me links.
 */
export function normalizeVendorWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export interface VendorOrderLineDraft {
  itemName: string;
  quantity: number;
  unit: string;
}

/**
 * Builds a clean, polite Indonesian Purchase Order message ready for WhatsApp or clipboard copy.
 */
export function buildVendorOrderMessage(params: {
  vendor: Pick<VendorRecord, 'name' | 'contact_person'>;
  shopName: string;
  items: VendorOrderLineDraft[];
  notes?: string;
}): string {
  const greetingName = params.vendor.contact_person.trim() || params.vendor.name.trim();
  const lines = [
    `Halo ${greetingName} (${params.vendor.name}),`,
    `Kami dari *${params.shopName}* ingin melakukan pemesanan restock barang berikut:`,
    '',
  ];

  if (params.items.length === 0) {
    lines.push('- Mohon info ketersediaan stok & daftar harga terbaru.');
  } else {
    params.items.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.itemName} — ${item.quantity} ${item.unit}`);
    });
  }

  if (params.notes?.trim()) {
    lines.push('', `Catatan: ${params.notes.trim()}`);
  }

  lines.push('', 'Mohon konfirmasi total tagihan & estimasi jadwal pengiriman. Terima kasih!');
  return lines.join('\n');
}

/**
 * Builds a wa.me deep link with encoded Purchase Order text.
 */
export function buildVendorWhatsAppUrl(phone: string, message: string): string | null {
  const normalized = normalizeVendorWhatsAppPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
