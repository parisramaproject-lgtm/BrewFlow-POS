import { useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  MessageSquare,
  PackageCheck,
  Printer,
  QrCode,
  ReceiptText,
  X,
} from 'lucide-react';
import { PrintableReceipt } from '../common/PrintableReceipt';
import type { CreateOrderResult } from '../../context/StoreContext';
import { printOrderReceipt } from '../../services/thermalPrinterService';
import type { Customer, PaymentMethod, StoreSettings } from '../../types';
import { formatRupiah } from '../../utils/format';
import type { CartSummary } from '../../utils/posCalculations';

interface PaymentModalProps {
  isOpen: boolean;
  orderNumber: string;
  summary: CartSummary;
  customer: Customer | null;
  settings: StoreSettings;
  onClose: () => void;
  onConfirm: (paymentMethod: PaymentMethod) => Promise<CreateOrderResult | null>;
}

const PAYMENT_METHODS: Array<{
  id: PaymentMethod;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'qris', label: 'QRIS', subtitle: 'E-Wallet / Mobile Banking', icon: QrCode },
  { id: 'cash', label: 'Tunai', subtitle: 'Pembayaran Cash', icon: Banknote },
  { id: 'debit', label: 'Debit', subtitle: 'Kartu EDC Bank', icon: CreditCard },
];

export function PaymentModal({
  isOpen,
  orderNumber,
  summary,
  customer,
  settings,
  onClose,
  onConfirm,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('qris');
  const [cashReceived, setCashReceived] = useState<string>(String(summary.totalAmount));
  const [debitRef, setDebitRef] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [completedResult, setCompletedResult] = useState<CreateOrderResult | null>(null);
  const [confirmedCashReceived, setConfirmedCashReceived] = useState<number>(0);
  const [confirmedCashChange, setConfirmedCashChange] = useState<number>(0);
  const [showReceiptPreview, setShowReceiptPreview] = useState<boolean>(false);
  const [printingReceipt, setPrintingReceipt] = useState<boolean>(false);
  const [printFeedback, setPrintFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isOpen) return null;

  const numericCash = Number(cashReceived.replace(/\D/g, '')) || 0;
  const cashChange = numericCash - summary.totalAmount;
  const canSubmitCash = paymentMethod !== 'cash' || numericCash >= summary.totalAmount;

  const quickCashOptions = [
    { label: 'Uang Pas', value: summary.totalAmount },
    { label: 'Rp 50.000', value: 50000 },
    { label: 'Rp 100.000', value: 100000 },
    { label: 'Rp 200.000', value: 200000 },
  ];

  const triggerReceiptPrint = async (
    result: CreateOrderResult,
    received: number,
    change: number
  ) => {
    setPrintingReceipt(true);
    const res = await printOrderReceipt(settings, result.order, {
      cashReceived: received,
      cashChange: change,
      pointsEarned: result.pointsEarned,
    });
    setPrintingReceipt(false);
    setPrintFeedback({ ok: res.ok, text: res.message });
  };

  const handleConfirm = async () => {
    if (!canSubmitCash || processing) return;
    const receivedSnapshot = paymentMethod === 'cash' ? numericCash : summary.totalAmount;
    const changeSnapshot =
      paymentMethod === 'cash' ? Math.max(0, numericCash - summary.totalAmount) : 0;
    setProcessing(true);
    const result = await onConfirm(paymentMethod);
    setProcessing(false);
    if (result) {
      setConfirmedCashReceived(receivedSnapshot);
      setConfirmedCashChange(changeSnapshot);
      setCompletedResult(result);
      setShowReceiptPreview(false);
      setPrintFeedback(null);

      if (settings.printerAutoPrintAfterPayment) {
        void triggerReceiptPrint(result, receivedSnapshot, changeSnapshot);
      }
    }
  };

  const handleCloseAll = () => {
    setCompletedResult(null);
    setConfirmedCashReceived(0);
    setConfirmedCashChange(0);
    setShowReceiptPreview(false);
    setPrintFeedback(null);
    setDebitRef('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Modal Pembayaran Pesanan"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-[#1A2E26]">
              {completedResult ? 'Pembayaran Berhasil' : 'Proses Pembayaran'}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-[#6B7280]">
              {completedResult ? completedResult.order.order_number : orderNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCloseAll}
            aria-label="Tutup modal pembayaran"
            className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Post-payment Digital Receipt Summary */}
        {completedResult ? (
          <div className="p-6">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E6F5EE] text-[#109A58]">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="mt-3 text-lg font-bold text-[#1A2E26] tabular-nums">
                {formatRupiah(completedResult.order.total_amount)}
              </p>
              <p className="mt-0.5 text-xs text-[#6B7280]">
                Metode:{' '}
                {completedResult.order.payment_method === 'qris'
                  ? 'QRIS'
                  : completedResult.order.payment_method === 'debit'
                    ? 'Kartu Debit'
                    : 'Tunai'}
                {completedResult.order.payment_method === 'cash' && confirmedCashChange > 0
                  ? ` · Kembalian ${formatRupiah(confirmedCashChange)}`
                  : ''}
              </p>
            </div>

            <div className="mt-5 space-y-2.5 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[#6B7280]">
                  <ReceiptText className="h-3.5 w-3.5 text-[#109A58]" />
                  Status Transaksi
                </span>
                <span className="font-semibold text-[#109A58]">
                  {completedResult.syncStatus.mode === 'supabase' ? 'Tersimpan (Supabase)' : 'Tersimpan'}
                </span>
              </div>

              {completedResult.pointsEarned > 0 && completedResult.order.customer_name && (
                <div className="flex items-center justify-between">
                  <span className="text-[#6B7280]">
                    Poin Member ({completedResult.order.customer_name})
                  </span>
                  <span className="font-semibold text-[#109A58] tabular-nums">
                    +{completedResult.pointsEarned} poin
                  </span>
                </div>
              )}

              {completedResult.whatsappReceiptLog && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[#6B7280]">
                    <MessageSquare className="h-3.5 w-3.5 text-[#109A58]" />
                    Struk WhatsApp Member
                  </span>
                  <span
                    className={`font-semibold ${
                      completedResult.whatsappReceiptLog.status === 'sent'
                        ? 'text-[#109A58]'
                        : 'text-[#EF4444]'
                    }`}
                  >
                    {completedResult.whatsappReceiptLog.status === 'sent'
                      ? 'Terkirim Otomatis'
                      : 'Gagal Kirim'}
                  </span>
                </div>
              )}

              {completedResult.deductions.length > 0 && (
                <div className="border-t border-[#E5E7EB] pt-2.5">
                  <p className="flex items-center gap-1.5 font-semibold text-[#1A2E26]">
                    <PackageCheck className="h-3.5 w-3.5 text-[#109A58]" />
                    Pengurangan Stok Otomatis (Resep BOM)
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[11px] text-[#6B7280]">
                    {completedResult.deductions.slice(0, 4).map((d) => (
                      <li key={d.inventoryItemId} className="flex justify-between tabular-nums">
                        <span className="truncate pr-2">{d.itemName}</span>
                        <span className="shrink-0 font-medium text-[#1A2E26]">
                          -{d.quantityDeducted} {d.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {printFeedback && (
              <div
                role="status"
                className={`mt-3 rounded-xl border px-3 py-2 text-[11px] ${
                  printFeedback.ok
                    ? 'border-[#109A58]/30 bg-[#E6F5EE] text-[#109A58]'
                    : 'border-[#F59E0B]/40 bg-[#FFFBEB] text-[#B45309]'
                }`}
              >
                <p>{printFeedback.text}</p>
                {!printFeedback.ok && (
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="mt-1 font-semibold underline"
                  >
                    Cetak via Driver Browser Sekarang
                  </button>
                )}
              </div>
            )}

            {/* Hidden or Expanded Printable Receipt Target */}
            <div className={showReceiptPreview ? 'mt-4 max-h-72 overflow-y-auto rounded-xl bg-[#F4F6F5] p-3' : 'sr-only print:not-sr-only'}>
              <PrintableReceipt
                settings={settings}
                order={completedResult.order}
                cashReceived={confirmedCashReceived}
                cashChange={confirmedCashChange}
                pointsEarned={completedResult.pointsEarned}
                isPrintTarget
              />
            </div>

            <div className="mt-4 flex items-center justify-center">
              <button
                type="button"
                onClick={() => setShowReceiptPreview((prev) => !prev)}
                className="text-xs font-semibold text-[#109A58] hover:underline"
              >
                {showReceiptPreview ? 'Sembunyikan Preview Struk' : 'Lihat Preview Struk Thermal'}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <button
                type="button"
                disabled={printingReceipt}
                onClick={() =>
                  void triggerReceiptPrint(
                    completedResult,
                    confirmedCashReceived,
                    confirmedCashChange
                  )
                }
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#E6F5EE] text-sm font-semibold text-[#109A58] transition-colors hover:bg-[#D5EFE2] disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span>{printingReceipt ? 'Mencetak...' : 'Cetak Struk'}</span>
              </button>
              <button
                type="button"
                onClick={handleCloseAll}
                className="flex h-11 flex-1 items-center justify-center rounded-full bg-[#109A58] text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E]"
              >
                Transaksi Baru
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {/* Total Tagihan Card */}
            <div className="rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-4">
              <div className="flex items-center justify-between text-xs text-[#6B7280]">
                <span>Subtotal ({summary.itemCount} item)</span>
                <span className="tabular-nums">{formatRupiah(summary.subtotal)}</span>
              </div>
              {summary.discountAmount > 0 && (
                <div className="mt-1 flex items-center justify-between text-xs font-medium text-[#EF4444]">
                  <span>Diskon Member {customer?.tier}</span>
                  <span className="tabular-nums">-{formatRupiah(summary.discountAmount)}</span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between text-xs text-[#6B7280]">
                <span>
                  {settings.taxEnabled
                    ? `${settings.taxLabel || 'Pajak'} (${settings.taxPercent}%)`
                    : 'Pajak (Nonaktif)'}
                </span>
                <span className="tabular-nums">{formatRupiah(summary.taxAmount)}</span>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between border-t border-dashed border-[#D1D5DB] pt-2.5">
                <span className="text-xs font-semibold text-[#1A2E26]">Total Tagihan</span>
                <span className="text-2xl font-bold text-[#1A2E26] tabular-nums">
                  {formatRupiah(summary.totalAmount)}
                </span>
              </div>
            </div>

            {/* Metode Pembayaran */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-[#1A2E26]">Pilih Metode Pembayaran</p>
              <div className="mt-2 grid grid-cols-3 gap-2.5">
                {PAYMENT_METHODS.map((method) => {
                  const Icon = method.icon;
                  const active = paymentMethod === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(method.id);
                        if (method.id === 'cash') {
                          setCashReceived(String(summary.totalAmount));
                        }
                      }}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition-colors ${
                        active
                          ? 'border-[#109A58] bg-[#E6F5EE] text-[#109A58]'
                          : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#6B7280] hover:border-[#109A58]/40 hover:text-[#1A2E26]'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs font-semibold">{method.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Payment Method Body */}
            {paymentMethod === 'cash' && (
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="pos-cash-input" className="block text-xs font-semibold text-[#1A2E26]">
                    Nominal Uang Diterima (Rp)
                  </label>
                  <input
                    id="pos-cash-input"
                    type="number"
                    min={0}
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3.5 text-sm font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {quickCashOptions.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setCashReceived(String(opt.value))}
                      className="rounded-lg border border-[#E5E7EB] bg-[#F4F6F5] px-2 py-1.5 text-[11px] font-semibold text-[#1A2E26] transition-colors hover:border-[#109A58] hover:bg-[#E6F5EE] hover:text-[#109A58] whitespace-nowrap"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-xl bg-[#F4F6F5] px-3.5 py-2.5 text-xs">
                  <span className="font-medium text-[#6B7280]">Kembalian</span>
                  <span
                    data-testid="payment-change"
                    className={`text-sm font-bold tabular-nums ${
                      cashChange < 0 ? 'text-[#EF4444]' : 'text-[#109A58]'
                    }`}
                  >
                    {cashChange < 0
                      ? `Kurang ${formatRupiah(Math.abs(cashChange))}`
                      : formatRupiah(cashChange)}
                  </span>
                </div>
              </div>
            )}

            {paymentMethod === 'qris' && (
              <div className="mt-4 flex items-center gap-4 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] text-[#1A2E26]">
                  <QrCode className="h-10 w-10 text-[#1A2E26]" strokeWidth={1.6} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1A2E26]">QRIS BrewFlow Coffee</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#6B7280]">
                    Minta pelanggan memindai QRIS kasir lalu klik konfirmasi setelah notifikasi
                    pembayaran masuk.
                  </p>
                </div>
              </div>
            )}

            {paymentMethod === 'debit' && (
              <div className="mt-4">
                <label htmlFor="pos-debit-ref" className="block text-xs font-semibold text-[#1A2E26]">
                  No. Approval / 4 Digit Terakhir Kartu (Opsional)
                </label>
                <input
                  id="pos-debit-ref"
                  type="text"
                  value={debitRef}
                  onChange={(e) => setDebitRef(e.target.value)}
                  placeholder="Misal: 4821 / EDC-BCA"
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>
            )}

            {/* Footer Action Buttons */}
            <div className="mt-6 flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleCloseAll}
                className="h-11 flex-1 rounded-full border border-[#E5E7EB] bg-[#FFFFFF] text-sm font-semibold text-[#6B7280] transition-colors hover:text-[#1A2E26]"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!canSubmitCash || processing}
                onClick={handleConfirm}
                className="h-11 flex-1 rounded-full bg-[#109A58] text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing ? 'Menyimpan...' : 'Konfirmasi Bayar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
