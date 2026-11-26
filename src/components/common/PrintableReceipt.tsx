import { Coffee } from 'lucide-react';
import type { OrderRecord, StoreSettings } from '../../types';
import { formatDateTime, formatRupiah } from '../../utils/format';

interface PrintableReceiptProps {
  settings: StoreSettings;
  order: OrderRecord;
  cashReceived?: number;
  cashChange?: number;
  pointsEarned?: number;
  /** When true, attaches #brewflow-print-area so window.print() isolates this receipt */
  isPrintTarget?: boolean;
}

export function PrintableReceipt({
  settings,
  order,
  cashReceived,
  cashChange,
  pointsEarned = 0,
  isPrintTarget = false,
}: PrintableReceiptProps) {
  const is58 = settings.receiptPaperWidth === '58mm';
  const paymentLabel =
    order.payment_method === 'qris'
      ? 'QRIS'
      : order.payment_method === 'debit'
        ? 'Kartu Debit'
        : 'Tunai';
  const orderTypeLabel =
    order.order_type === 'dine_in'
      ? `Dine-in (${order.table_number})`
      : order.order_type === 'takeaway'
        ? 'Takeaway'
        : 'Delivery';

  return (
    <div
      id={isPrintTarget ? 'brewflow-print-area' : undefined}
      className={`mx-auto rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-4 font-mono text-[#1A2E26] shadow-xs ${
        is58 ? 'w-[252px] text-[11px]' : 'w-[310px] text-xs'
      }`}
    >
      {/* Header / Brand Logo */}
      <div className="flex flex-col items-center text-center">
        {settings.receiptShowLogo && (
          <div className="mb-2 flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]">
            {settings.shopLogoUrl ? (
              <img
                src={settings.shopLogoUrl}
                alt={`Logo ${settings.shopName}`}
                className="h-full w-full object-contain p-1"
              />
            ) : (
              <Coffee className="h-6 w-6 text-[#109A58]" strokeWidth={2.1} />
            )}
          </div>
        )}
        <p className="text-sm font-bold tracking-tight text-[#1A2E26]">{settings.shopName}</p>
        <p className="mt-0.5 leading-snug text-[#4B5563]">{settings.address}</p>
        {settings.phone && <p className="text-[#4B5563]">Telp: {settings.phone}</p>}
        {settings.receiptHeaderText.trim() && (
          <p className="mt-1.5 text-[10px] font-medium text-[#6B7280]">
            {settings.receiptHeaderText}
          </p>
        )}
      </div>

      <div className="my-3 border-t border-dashed border-[#9CA3AF]" />

      {/* Order Meta */}
      <div className="space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-[#6B7280]">No. Order</span>
          <span className="font-semibold">{order.order_number}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[#6B7280]">Waktu</span>
          <span className="tabular-nums">{formatDateTime(order.created_at)}</span>
        </div>
        {settings.receiptShowCashierAndTable && (
          <>
            <div className="flex justify-between gap-2">
              <span className="text-[#6B7280]">Kasir</span>
              <span>{order.cashier_name}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#6B7280]">Tipe</span>
              <span>{orderTypeLabel}</span>
            </div>
          </>
        )}
        {settings.receiptShowMemberInfo && order.customer_name && (
          <div className="flex justify-between gap-2">
            <span className="text-[#6B7280]">Member</span>
            <span className="font-semibold">{order.customer_name}</span>
          </div>
        )}
      </div>

      <div className="my-3 border-t border-dashed border-[#9CA3AF]" />

      {/* Itemized List */}
      <div className="space-y-2">
        {order.items.map((item) => (
          <div key={item.id}>
            <div className="flex justify-between gap-2 font-medium text-[#1A2E26]">
              <span className="min-w-0 flex-1">{item.menu_name}</span>
              <span className="shrink-0 tabular-nums">{formatRupiah(item.subtotal)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-[#6B7280] tabular-nums">
              <span>
                {item.quantity} x {formatRupiah(item.unit_price)}
              </span>
              {item.notes && <span className="truncate pl-2 italic">{item.notes}</span>}
            </div>
          </div>
        ))}
      </div>

      {order.notes && (
        <p className="mt-2.5 rounded bg-[#F4F6F5] px-2 py-1 text-[10px] text-[#4B5563]">
          Catatan: {order.notes}
        </p>
      )}

      <div className="my-3 border-t border-dashed border-[#9CA3AF]" />

      {/* Payment Breakdown */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-[#6B7280]">Subtotal</span>
          <span className="tabular-nums">{formatRupiah(order.subtotal)}</span>
        </div>
        {order.discount_amount > 0 && (
          <div className="flex justify-between text-[#EF4444]">
            <span>Diskon Member</span>
            <span className="tabular-nums">-{formatRupiah(order.discount_amount)}</span>
          </div>
        )}
        {order.tax_amount > 0 || settings.taxEnabled ? (
          <div className="flex justify-between gap-2">
            <span className="min-w-0 text-[#6B7280]">
              {settings.taxLabel || 'Pajak'} ({settings.taxEnabled ? `${settings.taxPercent}%` : '0%'})
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {formatRupiah(order.tax_amount)}
            </span>
          </div>
        ) : (
          <div className="flex justify-between gap-2 text-[10px] text-[#6B7280]">
            <span>Pajak</span>
            <span className="shrink-0 whitespace-nowrap">Tidak dikenakan</span>
          </div>
        )}

        <div className="my-2 border-t border-dashed border-[#9CA3AF]" />

        <div className="flex justify-between text-sm font-bold text-[#1A2E26]">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatRupiah(order.total_amount)}</span>
        </div>

        <div className="flex justify-between text-[11px] text-[#4B5563]">
          <span>Bayar ({paymentLabel})</span>
          <span className="tabular-nums">
            {formatRupiah(
              order.payment_method === 'cash' && cashReceived !== undefined
                ? cashReceived
                : order.total_amount
            )}
          </span>
        </div>

        {order.payment_method === 'cash' && cashChange !== undefined && cashChange > 0 && (
          <div className="flex justify-between text-[11px] font-semibold text-[#1A2E26]">
            <span>Kembalian</span>
            <span className="tabular-nums">{formatRupiah(cashChange)}</span>
          </div>
        )}

        {settings.receiptShowMemberInfo && pointsEarned > 0 && (
          <div className="flex justify-between pt-1 text-[10px] font-semibold text-[#109A58]">
            <span>Poin Didapat</span>
            <span className="tabular-nums">+{pointsEarned} pts</span>
          </div>
        )}
      </div>

      <div className="my-3 border-t border-dashed border-[#9CA3AF]" />

      {/* Footer & Customer Service */}
      <div className="space-y-1 text-center text-[10px] text-[#6B7280]">
        {settings.receiptShowCustomerService && settings.customerServiceContact.trim() && (
          <p className="font-medium text-[#1A2E26]">
            Customer Service: {settings.customerServiceContact}
          </p>
        )}
        {settings.receiptFooterText.trim() && (
          <p className="leading-relaxed">{settings.receiptFooterText}</p>
        )}
      </div>
    </div>
  );
}
