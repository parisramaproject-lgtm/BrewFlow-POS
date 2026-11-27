import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Printer, ReceiptText, X } from 'lucide-react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { PeriodicExcelExport } from '../components/common/PeriodicExcelExport';
import { PrintableReceipt } from '../components/common/PrintableReceipt';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { printOrderReceipt } from '../services/thermalPrinterService';
import type { OrderRecord, OrderStatus } from '../types';
import { buildOrdersExcelData } from '../utils/excelExport';
import { formatDateTime, formatRupiah } from '../utils/format';

interface OrdersPageProps {
  searchQuery: string;
}

export function OrdersPage({ searchQuery }: OrdersPageProps) {
  const { user } = useAuth();
  const { orders, settings, cancelOrder } = useStore();
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [printing, setPrinting] = useState(false);

  // Order cancellation confirmation dialog state
  const [cancellingOrder, setCancellingOrder] = useState<OrderRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const matchesSearch =
        !q ||
        order.order_number.toLowerCase().includes(q) ||
        (order.customer_name ?? '').toLowerCase().includes(q) ||
        order.cashier_name.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [orders, statusFilter, searchQuery]);

  const paymentLabel = (method: OrderRecord['payment_method']) =>
    method === 'qris' ? 'QRIS' : method === 'debit' ? 'Debit' : 'Tunai';

  const typeLabel = (type: OrderRecord['order_type']) =>
    type === 'dine_in' ? 'Dine-in' : type === 'takeaway' ? 'Takeaway' : 'Delivery';

  const handleConfirmCancelOrder = async () => {
    if (!cancellingOrder || !user) return;
    setCancelBusy(true);
    const orderNumber = cancellingOrder.order_number;
    const res = await cancelOrder({
      orderId: cancellingOrder.id,
      reason: cancelReason,
      cancelledByName: user.full_name,
      cancelledByRole: user.role,
    });
    setCancelBusy(false);
    setCancellingOrder(null);
    setCancelReason('');
    if (selectedOrder?.id === cancellingOrder.id) {
      setSelectedOrder((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
    }
    setFeedbackMsg(
      res.error
        ? `Pesanan ${orderNumber} dibatalkan lokal (${res.error}).`
        : `Pesanan ${orderNumber} berhasil dibatalkan dan notifikasi dikirim ke Owner/Manager.`
    );
    window.setTimeout(() => setFeedbackMsg(null), 5000);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Riwayat Pesanan</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Daftar seluruh transaksi selesai, draft, dan pesanan dibatalkan dari kasir.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-1">
            {[
              { id: 'all' as const, label: 'Semua' },
              { id: 'completed' as const, label: 'Selesai' },
              { id: 'draft' as const, label: 'Draft' },
              { id: 'cancelled' as const, label: 'Batal' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <PeriodicExcelExport
            moduleTitle="Pesanan"
            description="Tarik ringkasan penjualan, daftar transaksi, dan detail item per periode."
            testId="export-orders-excel"
            buildExport={({ startDate, endDate }) =>
              buildOrdersExcelData({
                orders,
                startDate,
                endDate,
                statusFilter,
                shopName: settings.shopName,
              })
            }
          />
        </div>
      </div>

      {feedbackMsg && (
        <div
          role="status"
          data-testid="orders-feedback-banner"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{feedbackMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            aria-label="Tutup pesan status pesanan"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <ReceiptText className="h-9 w-9 text-[#6B7280]/50" />
            <p className="mt-3 text-sm font-semibold text-[#1A2E26]">Belum ada pesanan</p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Pesanan baru dari layar Kasir / POS akan langsung tercatat di sini.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 text-xs font-semibold text-[#6B7280]">
                  <th className="px-5 py-3.5">No. Order</th>
                  <th className="px-5 py-3.5">Waktu</th>
                  <th className="px-5 py-3.5">Pelanggan / Tipe</th>
                  <th className="px-5 py-3.5">Kasir</th>
                  <th className="px-5 py-3.5">Pembayaran</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Total</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-[#F4F6F5]/50">
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#1A2E26]">
                      {order.order_number}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#6B7280] tabular-nums">
                      {formatDateTime(order.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#1A2E26]">
                      <span className="font-medium">{order.customer_name || 'Walk-in Guest'}</span>
                      <span className="ml-1.5 text-[#6B7280]">
                        · {typeLabel(order.order_type)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#6B7280]">{order.cashier_name}</td>
                    <td className="px-5 py-3.5 text-xs text-[#1A2E26]">
                      {paymentLabel(order.payment_method)}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-semibold">
                      <span
                        className={
                          order.status === 'completed'
                            ? 'text-[#109A58]'
                            : order.status === 'cancelled'
                              ? 'text-[#EF4444]'
                              : 'text-[#F59E0B]'
                        }
                      >
                        {order.status === 'completed'
                          ? 'Selesai'
                          : order.status === 'cancelled'
                            ? 'Dibatalkan'
                            : 'Draft'}
                      </span>
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right text-xs font-bold tabular-nums ${
                        order.status === 'cancelled'
                          ? 'text-[#9CA3AF] line-through'
                          : 'text-[#1A2E26]'
                      }`}
                    >
                      {formatRupiah(order.total_amount)}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="text-xs font-semibold text-[#109A58] hover:underline"
                        >
                          Lihat Struk
                        </button>
                        {order.status !== 'cancelled' && (
                          <button
                            type="button"
                            data-testid={`cancel-order-btn-${order.id}`}
                            onClick={() => {
                              setCancellingOrder(order);
                              setCancelReason('');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#EF4444] hover:underline"
                          >
                            <Ban className="h-3 w-3" />
                            <span>Batalkan</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Detail Modal with Custom Thermal Receipt & Print */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Detail Struk ${selectedOrder.order_number}`}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3.5">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Struk {selectedOrder.order_number}
                </h2>
                <p className="text-xs text-[#6B7280]">
                  {formatDateTime(selectedOrder.created_at)} · {selectedOrder.table_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Tutup detail struk"
                className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 max-h-[56vh] overflow-y-auto rounded-xl bg-[#F4F6F5] p-4">
              <PrintableReceipt settings={settings} order={selectedOrder} isPrintTarget />
            </div>

            {printMsg && (
              <div
                role="status"
                className={`mt-3 rounded-xl border px-3 py-2 text-[11px] ${
                  printMsg.ok
                    ? 'border-[#109A58]/30 bg-[#E6F5EE] text-[#109A58]'
                    : 'border-[#F59E0B]/40 bg-[#FFFBEB] text-[#B45309]'
                }`}
              >
                <p>{printMsg.text}</p>
                {!printMsg.ok && (
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="mt-1 font-semibold underline"
                  >
                    Cetak via Driver Browser
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              {selectedOrder.status !== 'cancelled' ? (
                <button
                  type="button"
                  onClick={() => {
                    setCancellingOrder(selectedOrder);
                    setCancelReason('');
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] px-4 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2]"
                >
                  <Ban className="h-3.5 w-3.5" />
                  <span>Batalkan Pesanan</span>
                </button>
              ) : (
                <span className="rounded-full bg-[#FEF2F2] px-3 py-1 text-xs font-semibold text-[#DC2626]">
                  Status: Dibatalkan
                </span>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrder(null);
                    setPrintMsg(null);
                  }}
                  className="h-10 rounded-full border border-[#E5E7EB] px-4 text-xs font-semibold text-[#6B7280] hover:text-[#1A2E26]"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={printing}
                  onClick={async () => {
                    setPrinting(true);
                    const res = await printOrderReceipt(settings, selectedOrder);
                    setPrinting(false);
                    setPrintMsg({ ok: res.ok, text: res.message });
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  <span>{printing ? 'Mencetak...' : 'Cetak Struk'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Cancellation Confirmation Notice */}
      <ConfirmDialog
        open={Boolean(cancellingOrder)}
        variant="danger"
        title="Konfirmasi Pembatalan Pesanan"
        description={
          cancellingOrder && (
            <div className="space-y-3">
              <p>
                Anda akan membatalkan pesanan{' '}
                <strong className="font-mono text-[#1A2E26]">
                  {cancellingOrder.order_number}
                </strong>{' '}
                senilai{' '}
                <strong className="text-[#1A2E26]">
                  {formatRupiah(cancellingOrder.total_amount)}
                </strong>
                . Status pesanan akan berubah menjadi <strong>Dibatalkan</strong> dan tercatat untuk
                Owner &amp; Manager.
              </p>
              <div>
                <label
                  htmlFor="cancel-order-reason"
                  className="block text-[11px] font-semibold text-[#1A2E26]"
                >
                  Alasan Pembatalan (Opsional)
                </label>
                <input
                  id="cancel-order-reason"
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Contoh: Pelanggan ganti menu / salah input item"
                  className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#EF4444] focus:outline-none"
                />
              </div>
            </div>
          )
        }
        confirmLabel="Ya, Batalkan Pesanan"
        cancelLabel="Kembali"
        isBusy={cancelBusy}
        onCancel={() => {
          setCancellingOrder(null);
          setCancelReason('');
        }}
        onConfirm={handleConfirmCancelOrder}
      />
    </div>
  );
}
