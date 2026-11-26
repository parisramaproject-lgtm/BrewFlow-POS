// Supabase Edge Function: supabase/functions/send-whatsapp/index.ts
// Deploy: supabase functions deploy send-whatsapp
// Secrets required:
//   supabase secrets set WHATSAPP_GATEWAY_URL=https://api.fonnte.com/send
//   supabase secrets set WHATSAPP_API_TOKEN=YOUR_GATEWAY_TOKEN
//   supabase secrets set WHATSAPP_GATEWAY_PROVIDER=fonnte   # 'fonnte' | 'wablas'

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type NotificationEventType =
  | 'opname_reminder'
  | 'low_stock_alert'
  | 'pos_receipt'
  | 'opname_report'
  | 'test_message';

interface WhatsAppRequestPayload {
  eventType: NotificationEventType;
  targets: string[]; // One or more recipient phone numbers (e.g. ["0812xxxx"])
  shopName?: string;
  customMessage?: string;
  data?: {
    // opname_reminder
    scheduleTitle?: string;
    executionTime?: string;
    frequencyLabel?: string;
    targetCategoryLabel?: string;
    // low_stock_alert
    lowStockItems?: Array<{
      name: string;
      current_stock: number;
      min_stock_threshold: number;
      unit: string;
    }>;
    // pos_receipt
    orderNumber?: string;
    customerName?: string;
    items?: Array<{ name: string; quantity: number; subtotal: number }>;
    subtotal?: number;
    discountAmount?: number;
    taxAmount?: number;
    totalAmount?: number;
    paymentMethod?: string;
    pointsEarned?: number;
    totalPoints?: number;
    memberTier?: string;
    // opname_report
    performedBy?: string;
    totalItemsChecked?: number;
    discrepancyCount?: number;
    notes?: string;
    discrepancies?: Array<{
      name: string;
      systemStock: number;
      actualStock: number;
      variance: number;
      unit: string;
      reason?: string;
    }>;
  };
}

function normalizeIndonesianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  return `62${digits}`;
}

function formatIdr(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function buildMessage(payload: WhatsAppRequestPayload): string {
  if (payload.customMessage?.trim()) {
    return payload.customMessage.trim();
  }

  const shop = payload.shopName || 'BrewFlow POS';
  const d = payload.data ?? {};

  switch (payload.eventType) {
    case 'opname_reminder': {
      return [
        `*[${shop}] Pengingat Jadwal Stock Opname*`,
        ``,
        `Jadwal: *${d.scheduleTitle || 'Stock Opname Rutin'}*`,
        `Frekuensi: ${d.frequencyLabel || 'Terjadwal'}`,
        `Jam Eksekusi: ${d.executionTime || '-'} WIB`,
        `Target Kategori: ${d.targetCategoryLabel || 'Semua'}`,
        ``,
        `Mohon segera lakukan pengecekan stok fisik melalui menu *Stock Opname* di aplikasi BrewFlow POS.`,
      ].join('\n');
    }

    case 'low_stock_alert': {
      const rows = (d.lowStockItems ?? [])
        .map(
          (item, i) =>
            `${i + 1}. ${item.name}: sisa *${item.current_stock} ${item.unit}* (min. ${item.min_stock_threshold} ${item.unit})`
        )
        .join('\n');
      return [
        `*[${shop}] Peringatan Stok Menipis*`,
        ``,
        `Bahan baku / kemasan berikut berada di bawah batas minimum:`,
        rows || '- Tidak ada rincian item.',
        ``,
        `Segera jadwalkan pembelian ke supplier melalui menu *Pembelian (Purchasing)*.`,
      ].join('\n');
    }

    case 'pos_receipt': {
      const itemLines = (d.items ?? [])
        .map((item) => `• ${item.name} (${item.quantity}x) — ${formatIdr(item.subtotal)}`)
        .join('\n');
      const lines = [
        `*${shop} — Struk Digital*`,
        `No. Order: ${d.orderNumber || '-'}`,
        d.customerName ? `Pelanggan: ${d.customerName}` : null,
        `--------------------------------`,
        itemLines,
        `--------------------------------`,
        `Subtotal: ${formatIdr(d.subtotal ?? 0)}`,
        d.discountAmount && d.discountAmount > 0
          ? `Diskon Member: -${formatIdr(d.discountAmount)}`
          : null,
        `Pajak: ${formatIdr(d.taxAmount ?? 0)}`,
        `*Total Bayar: ${formatIdr(d.totalAmount ?? 0)}*`,
        `Metode: ${d.paymentMethod || 'Tunai'}`,
      ].filter(Boolean);

      if (d.pointsEarned && d.pointsEarned > 0) {
        lines.push(
          ``,
          `Selamat! Anda mendapatkan *+${d.pointsEarned} poin* member.`,
          d.totalPoints !== undefined
            ? `Total Poin Anda: *${d.totalPoints} pts* (${d.memberTier || 'Member'})`
            : ''
        );
      }
      lines.push(``, `Terima kasih telah berkunjung ke ${shop}!`);
      return lines.filter((l) => l !== '').join('\n');
    }

    case 'opname_report': {
      const diffLines =
        (d.discrepancies ?? []).length > 0
          ? (d.discrepancies ?? [])
              .map(
                (item, i) =>
                  `${i + 1}. ${item.name}: Sistem ${item.systemStock} -> Fisik ${item.actualStock} ${item.unit} (*Selisih ${item.variance > 0 ? `+${item.variance}` : item.variance} ${item.unit}*${item.reason ? ` · ${item.reason}` : ''})`
              )
              .join('\n')
          : 'Tidak ditemukan selisih stok (100% sesuai sistem).';

      return [
        `*[${shop}] Laporan Hasil Stock Opname*`,
        ``,
        `Jadwal: *${d.scheduleTitle || 'Stock Opname'}*`,
        `Petugas: ${d.performedBy || '-'}`,
        `Diperiksa: ${d.totalItemsChecked ?? 0} item (${d.discrepancyCount ?? 0} item berselisih)`,
        ``,
        `*Ringkasan Selisih:*`,
        diffLines,
        d.notes ? `\nCatatan: ${d.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'test_message':
    default:
      return `[${shop}] Tes koneksi WhatsApp Gateway berhasil. Notifikasi otomatis BrewFlow POS aktif.`;
  }
}

async function dispatchToGateway(params: {
  provider: string;
  gatewayUrl: string;
  apiToken: string;
  targetPhone: string;
  message: string;
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { provider, gatewayUrl, apiToken, targetPhone, message } = params;

  if (provider === 'wablas') {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        Authorization: apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: targetPhone,
        message,
      }),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }

  // Default: Fonnte REST API standard (multipart/form-data or URL-encoded form)
  const form = new URLSearchParams();
  form.append('target', targetPhone);
  form.append('message', message);
  form.append('countryCode', '62');

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      Authorization: apiToken,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = (await req.json()) as WhatsAppRequestPayload;
    if (!payload?.eventType || !Array.isArray(payload.targets) || payload.targets.length === 0) {
      return new Response(
        JSON.stringify({ error: 'eventType dan minimal 1 nomor tujuan (targets) wajib diisi.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const gatewayUrl = Deno.env.get('WHATSAPP_GATEWAY_URL') || 'https://api.fonnte.com/send';
    const apiToken = Deno.env.get('WHATSAPP_API_TOKEN') || '';
    const provider = (Deno.env.get('WHATSAPP_GATEWAY_PROVIDER') || 'fonnte').toLowerCase();

    if (!apiToken) {
      return new Response(
        JSON.stringify({
          error:
            'Secret WHATSAPP_API_TOKEN belum dikonfigurasi di Supabase Edge Function Secrets.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const message = buildMessage(payload);
    const normalizedTargets = payload.targets
      .map(normalizeIndonesianPhone)
      .filter((num) => num.length >= 10);

    if (normalizedTargets.length === 0) {
      return new Response(JSON.stringify({ error: 'Tidak ada nomor WhatsApp tujuan yang valid.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = await Promise.all(
      normalizedTargets.map(async (targetPhone) => {
        const res = await dispatchToGateway({
          provider,
          gatewayUrl,
          apiToken,
          targetPhone,
          message,
        });
        return { targetPhone, ...res };
      })
    );

    const allSucceeded = results.every((r) => r.ok);
    return new Response(
      JSON.stringify({
        success: allSucceeded,
        eventType: payload.eventType,
        provider,
        sentCount: results.filter((r) => r.ok).length,
        results,
      }),
      {
        status: allSucceeded ? 200 : 207,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Unexpected error in send-whatsapp function.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
