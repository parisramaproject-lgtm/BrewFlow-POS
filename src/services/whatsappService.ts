import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  InventoryItem,
  OrderRecord,
  StockOpnameDetailItem,
  StockOpnameSchedule,
  WhatsAppEventType,
  WhatsAppLogEntry,
} from '../types';
import { formatRupiah } from '../utils/format';
import { getCategoryTargetLabel, getFrequencyDescription } from '../utils/opnameScheduler';

export function normalizeWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  return `62${digits}`;
}

export interface SendWhatsAppParams {
  eventType: WhatsAppEventType;
  targets: string[];
  shopName: string;
  data?: Record<string, unknown>;
  customMessage?: string;
  enableSupabaseSync?: boolean;
}

function summarizePreview(params: SendWhatsAppParams): string {
  if (params.customMessage) return params.customMessage;
  const d = (params.data ?? {}) as Record<string, unknown>;
  switch (params.eventType) {
    case 'opname_reminder':
      return `Pengingat Opname "${String(d.scheduleTitle ?? '-')}" (${String(d.executionTime ?? '-')})`;
    case 'low_stock_alert': {
      const items = (d.lowStockItems as Array<{ name: string }> | undefined) ?? [];
      return `Alert Stok Menipis: ${items.map((i) => i.name).join(', ')}`;
    }
    case 'pos_receipt':
      return `Struk Digital ${String(d.orderNumber ?? '-')} · Total ${formatRupiah(Number(d.totalAmount ?? 0))}`;
    case 'opname_report':
      return `Laporan Opname "${String(d.scheduleTitle ?? '-')}" · ${Number(d.discrepancyCount ?? 0)} item berselisih`;
    case 'test_message':
    default:
      return `Tes koneksi WhatsApp Gateway (${params.shopName})`;
  }
}

/**
 * Triggers the Supabase Edge Function `send-whatsapp` when connected to live Supabase.
 * Falls back cleanly to a local log entry when Edge Function sync is not active.
 */
export async function dispatchWhatsAppNotification(
  params: SendWhatsAppParams
): Promise<WhatsAppLogEntry> {
  const normalizedTargets = params.targets
    .map(normalizeWhatsAppPhone)
    .filter((p) => p.length >= 10);

  const nowIso = new Date().toISOString();
  const preview = summarizePreview(params);

  if (normalizedTargets.length === 0) {
    return {
      id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      event_type: params.eventType,
      targets: [],
      preview,
      mode: 'local',
      status: 'failed',
      error: 'Nomor WhatsApp tujuan belum diisi atau tidak valid.',
      sent_at: nowIso,
    };
  }

  if (!params.enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return {
      id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      event_type: params.eventType,
      targets: normalizedTargets,
      preview,
      mode: 'local',
      status: 'sent',
      sent_at: nowIso,
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-whatsapp', {
      body: {
        eventType: params.eventType,
        targets: normalizedTargets,
        shopName: params.shopName,
        customMessage: params.customMessage,
        data: params.data,
      },
    });

    if (error) {
      return {
        id: `wa-${Date.now()}`,
        event_type: params.eventType,
        targets: normalizedTargets,
        preview,
        mode: 'edge_function',
        status: 'failed',
        error: error.message,
        sent_at: nowIso,
      };
    }

    const ok = Boolean((data as { success?: boolean } | null)?.success ?? true);
    return {
      id: `wa-${Date.now()}`,
      event_type: params.eventType,
      targets: normalizedTargets,
      preview,
      mode: 'edge_function',
      status: ok ? 'sent' : 'failed',
      error: ok ? undefined : 'Sebagian pesan gagal terkirim oleh gateway.',
      sent_at: nowIso,
    };
  } catch (err) {
    return {
      id: `wa-${Date.now()}`,
      event_type: params.eventType,
      targets: normalizedTargets,
      preview,
      mode: 'edge_function',
      status: 'failed',
      error: err instanceof Error ? err.message : 'Gagal memanggil Edge Function send-whatsapp.',
      sent_at: nowIso,
    };
  }
}

export function buildOpnameReminderPayload(schedule: StockOpnameSchedule) {
  return {
    scheduleTitle: schedule.title,
    executionTime: schedule.execution_time,
    frequencyLabel: getFrequencyDescription(schedule),
    targetCategoryLabel: getCategoryTargetLabel(schedule.target_category),
  };
}

export function buildLowStockPayload(items: InventoryItem[]) {
  return {
    lowStockItems: items.map((item) => ({
      name: item.name,
      current_stock: item.current_stock,
      min_stock_threshold: item.min_stock_threshold,
      unit: item.unit,
    })),
  };
}

export function buildPosReceiptPayload(params: {
  order: OrderRecord;
  pointsEarned: number;
  totalPoints?: number;
  memberTier?: string;
}) {
  const { order, pointsEarned, totalPoints, memberTier } = params;
  return {
    orderNumber: order.order_number,
    customerName: order.customer_name ?? undefined,
    items: order.items.map((item) => ({
      name: item.menu_name,
      quantity: item.quantity,
      subtotal: item.subtotal,
    })),
    subtotal: order.subtotal,
    discountAmount: order.discount_amount,
    taxAmount: order.tax_amount,
    totalAmount: order.total_amount,
    paymentMethod:
      order.payment_method === 'qris'
        ? 'QRIS'
        : order.payment_method === 'debit'
          ? 'Kartu Debit'
          : 'Tunai',
    pointsEarned,
    totalPoints,
    memberTier,
  };
}

export function buildOpnameReportPayload(params: {
  scheduleTitle: string;
  performedBy: string;
  totalItemsChecked: number;
  discrepancyCount: number;
  notes: string;
  details: StockOpnameDetailItem[];
}) {
  return {
    scheduleTitle: params.scheduleTitle,
    performedBy: params.performedBy,
    totalItemsChecked: params.totalItemsChecked,
    discrepancyCount: params.discrepancyCount,
    notes: params.notes,
    discrepancies: params.details
      .filter((d) => d.variance !== 0)
      .map((d) => ({
        name: d.item_name,
        systemStock: d.system_stock,
        actualStock: d.actual_stock,
        variance: d.variance,
        unit: d.unit,
        reason: d.reason,
      })),
  };
}
