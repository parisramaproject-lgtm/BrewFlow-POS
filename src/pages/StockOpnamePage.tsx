import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  Eye,
  MessageSquare,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { PeriodicExcelExport } from '../components/common/PeriodicExcelExport';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { StockOpnameLog } from '../types';
import { buildStockOpnameExcelData } from '../utils/excelExport';
import { formatDateTime, formatRupiah } from '../utils/format';
import { getCategoryTargetLabel, getFrequencyDescription } from '../utils/opnameScheduler';
import { calculateOpnameVariance } from '../utils/posCalculations';

export function StockOpnamePage() {
  const { user, authMode } = useAuth();
  const {
    inventory,
    opnameSchedules,
    dueOpnameSchedules,
    opnameLogs,
    settings,
    submitStockOpname,
    refreshAllFromSupabase,
  } = useStore();
  const liveSupabaseEnabled = authMode === 'supabase';

  const activeSchedules = useMemo(
    () => opnameSchedules.filter((s) => s.is_active),
    [opnameSchedules]
  );

  const dueIds = useMemo(
    () => new Set(dueOpnameSchedules.map((s) => s.id)),
    [dueOpnameSchedules]
  );

  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(
    dueOpnameSchedules[0]?.id ?? activeSchedules[0]?.id ?? opnameSchedules[0]?.id ?? ''
  );
  const [actualCounts, setActualCounts] = useState<Record<string, string>>({});
  const [itemReasons, setItemReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshingDb, setRefreshingDb] = useState(false);
  const [doneBanner, setDoneBanner] = useState<{
    message: string;
    whatsappStatus: string;
    supabaseSynced: boolean;
    supabaseDetail: string;
  } | null>(null);
  const [detailModalLog, setDetailModalLog] = useState<StockOpnameLog | null>(null);

  // Keep selected schedule valid when remote UUID schedules hydrate from Supabase
  useEffect(() => {
    if (opnameSchedules.length === 0) return;
    const exists = opnameSchedules.some((s) => s.id === selectedScheduleId);
    if (!exists) {
      setSelectedScheduleId(
        dueOpnameSchedules[0]?.id ?? activeSchedules[0]?.id ?? opnameSchedules[0]?.id ?? ''
      );
    }
  }, [opnameSchedules, activeSchedules, dueOpnameSchedules, selectedScheduleId]);

  const selectedSchedule =
    activeSchedules.find((s) => s.id === selectedScheduleId) ??
    activeSchedules[0] ??
    opnameSchedules[0];

  const targetItems = useMemo(() => {
    if (!selectedSchedule || selectedSchedule.target_category === 'all') {
      return inventory;
    }
    return inventory.filter((item) => item.category_type === selectedSchedule.target_category);
  }, [inventory, selectedSchedule]);

  // Live variance & estimated financial impact summary
  const liveStats = useMemo(() => {
    let discrepancyCount = 0;
    let estimatedVarianceValue = 0;
    for (const item of targetItems) {
      const raw = actualCounts[item.id];
      const numericActual =
        raw !== undefined && raw !== '' && !Number.isNaN(Number(raw))
          ? Number(raw)
          : item.current_stock;
      const variance = calculateOpnameVariance(item.current_stock, numericActual);
      if (variance !== 0) {
        discrepancyCount += 1;
        estimatedVarianceValue += variance * item.last_purchase_price;
      }
    }
    return { discrepancyCount, estimatedVarianceValue };
  }, [targetItems, actualCounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedSchedule || submitting) return;

    setSubmitting(true);
    const counts = targetItems.map((item) => {
      const raw = actualCounts[item.id];
      const parsed = raw !== undefined && raw !== '' ? Number(raw) : item.current_stock;
      return {
        inventoryItemId: item.id,
        actualStock: Number.isNaN(parsed) ? item.current_stock : parsed,
        reason: itemReasons[item.id]?.trim() || undefined,
      };
    });

    const result = await submitStockOpname({
      scheduleId: selectedSchedule.id,
      scheduleTitle: selectedSchedule.title,
      performedById: user.id,
      performedByName: user.full_name,
      notes,
      counts,
      enableSupabaseSync: liveSupabaseEnabled,
    });

    setSubmitting(false);
    setActualCounts({});
    setItemReasons({});
    setNotes('');

    const waStatusText = result.whatsappLog
      ? result.whatsappLog.status === 'sent'
        ? `Laporan ringkasan selisih terkirim ke WhatsApp Owner (${settings.whatsappOwnerPhone}) via ${
            result.whatsappLog.mode === 'edge_function' ? 'Supabase Edge Function' : 'Antrean Lokal'
          }.`
        : `Pengiriman WhatsApp ke Owner gagal: ${result.whatsappLog.error ?? 'Periksa konfigurasi gateway.'}`
      : 'Nomor WhatsApp Owner belum dikonfigurasi.';

    const supabaseSynced = result.syncStatus.synced;
    const supabaseDetail =
      result.syncStatus.mode === 'supabase'
        ? supabaseSynced
          ? 'Berhasil tersinkron ke database Supabase (inventory_items, stock_opname_logs, stock_opname_details & jadwal).'
          : `Sinkronisasi ke Supabase GAGAL: ${result.syncStatus.error ?? 'Periksa tabel & policy RLS di supabase/schema_full_brewflow.sql.'}`
        : 'Tersimpan di sesi lokal (koneksi Supabase belum aktif).';

    setDoneBanner({
      message: `Stock opname "${selectedSchedule.title}" tersimpan (${result.log.total_items_checked} item diperiksa, ${result.log.discrepancy_count} selisih). Stok inventori otomatis disesuaikan.`,
      whatsappStatus: waStatusText,
      supabaseSynced,
      supabaseDetail,
    });
  };

  const handleRefreshFromSupabase = async () => {
    setRefreshingDb(true);
    await refreshAllFromSupabase();
    setRefreshingDb(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Stock Opname Terjadwal</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Cocokkan stok fisik aktual dengan catatan sistem, catat keterangan selisih, dan kirim
            ringkasan otomatis ke WhatsApp Owner.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <PeriodicExcelExport
            moduleTitle="Stock Opname"
            description="Tarik riwayat sesi stock opname, perbandingan stok sistem vs fisik, dan nilai selisih per periode."
            testId="export-opname-excel"
            buildExport={({ startDate, endDate }) =>
              buildStockOpnameExcelData({
                opnameLogs,
                startDate,
                endDate,
                shopName: settings.shopName,
              })
            }
          />
          {liveSupabaseEnabled && (
            <button
              type="button"
              onClick={handleRefreshFromSupabase}
              disabled={refreshingDb}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#1A2E26] transition-colors hover:border-[#109A58] hover:text-[#109A58] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingDb ? 'animate-spin' : ''}`} />
              <span>{refreshingDb ? 'Memuat...' : 'Sinkronkan Database'}</span>
            </button>
          )}
          {dueOpnameSchedules.length > 0 && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[#EF4444]/30 bg-[#FEF2F2] px-4 py-1.5 text-xs font-semibold text-[#EF4444]">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{dueOpnameSchedules.length} jadwal jatuh tempo hari ini</span>
            </div>
          )}
        </div>
      </div>

      {doneBanner && (
        <div
          role="status"
          data-testid="opname-submit-status"
          className={`rounded-2xl border px-4 py-3.5 text-xs text-[#1A2E26] ${
            doneBanner.supabaseSynced
              ? 'border-[#109A58]/30 bg-[#E6F5EE]'
              : 'border-[#EF4444]/40 bg-[#FEF2F2]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {doneBanner.supabaseSynced ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#109A58]" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" />
            )}
            <div className="space-y-1">
              <p
                className={`font-semibold ${
                  doneBanner.supabaseSynced ? 'text-[#109A58]' : 'text-[#DC2626]'
                }`}
              >
                {doneBanner.message}
              </p>
              <p
                className={`flex items-center gap-1.5 text-[11px] font-medium ${
                  doneBanner.supabaseSynced ? 'text-[#109A58]' : 'text-[#DC2626]'
                }`}
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span>{doneBanner.supabaseDetail}</span>
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-[#1A2E26]/80">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#109A58]" />
                <span>{doneBanner.whatsappStatus}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Schedules Selector */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
          Jadwal Aktif ({activeSchedules.length})
        </h2>
        {activeSchedules.length === 0 ? (
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 text-center text-xs text-[#6B7280]">
            Belum ada jadwal stock opname aktif. Owner dapat menambahkan jadwal di menu Pengaturan
            &gt; Pengaturan Jadwal.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {activeSchedules.map((sch) => {
              const isSelected = sch.id === selectedSchedule?.id;
              const isDue = dueIds.has(sch.id);
              const countForCategory =
                sch.target_category === 'all'
                  ? inventory.length
                  : inventory.filter((i) => i.category_type === sch.target_category).length;

              return (
                <button
                  key={sch.id}
                  type="button"
                  onClick={() => {
                    setSelectedScheduleId(sch.id);
                    setActualCounts({});
                    setItemReasons({});
                  }}
                  className={`rounded-2xl border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-[#109A58] bg-[#E6F5EE]/60'
                      : isDue
                        ? 'border-[#EF4444]/40 bg-[#FFFFFF] hover:border-[#EF4444]'
                        : 'border-[#E5E7EB] bg-[#FFFFFF] hover:border-[#109A58]/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-[#1A2E26]">{sch.title}</span>
                    {isDue ? (
                      <span className="shrink-0 rounded-md bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-bold text-[#EF4444]">
                        Jatuh Tempo
                      </span>
                    ) : sch.last_completed_at ? (
                      <span className="shrink-0 rounded-md bg-[#E6F5EE] px-2 py-0.5 text-[10px] font-semibold text-[#109A58]">
                        Selesai
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#6B7280]">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>{getFrequencyDescription(sch)}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-[#6B7280]">
                    Target: <span className="font-medium text-[#1A2E26]">{getCategoryTargetLabel(sch.target_category)}</span>{' '}
                    · {countForCategory} item
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Opname Input Form */}
      {selectedSchedule && (
        <form
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E7EB] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#1A2E26]">{selectedSchedule.title}</h2>
                <p className="text-xs text-[#6B7280]">
                  Target: {getCategoryTargetLabel(selectedSchedule.target_category)} ·{' '}
                  {getFrequencyDescription(selectedSchedule)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="rounded-xl bg-[#F4F6F5] px-3 py-1.5">
                <span className="text-[#6B7280]">Item Berselisih: </span>
                <span
                  data-testid="opname-discrepancy-count"
                  className={`font-bold tabular-nums ${
                    liveStats.discrepancyCount > 0 ? 'text-[#EF4444]' : 'text-[#109A58]'
                  }`}
                >
                  {liveStats.discrepancyCount} / {targetItems.length}
                </span>
              </div>
              <div className="rounded-xl bg-[#F4F6F5] px-3 py-1.5">
                <span className="text-[#6B7280]">Dampak Nilai: </span>
                <span
                  className={`font-bold tabular-nums ${
                    liveStats.estimatedVarianceValue < 0
                      ? 'text-[#EF4444]'
                      : liveStats.estimatedVarianceValue > 0
                        ? 'text-[#109A58]'
                        : 'text-[#1A2E26]'
                  }`}
                >
                  {liveStats.estimatedVarianceValue > 0 ? '+' : ''}
                  {formatRupiah(liveStats.estimatedVarianceValue)}
                </span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 font-semibold text-[#6B7280]">
                  <th className="px-5 py-3">Item &amp; SKU</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Stok Sistem</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Stok Fisik Aktual</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Selisih (Variance)</th>
                  <th className="px-5 py-3">Keterangan Item (Opsional)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {targetItems.map((item) => {
                  const inputVal = actualCounts[item.id] ?? String(item.current_stock);
                  const numericActual =
                    inputVal === '' ? item.current_stock : Number(inputVal);
                  const variance = calculateOpnameVariance(item.current_stock, numericActual);
                  const hasVariance = variance !== 0;

                  return (
                    <tr
                      key={item.id}
                      className={hasVariance ? 'bg-[#FEF2F2]/40' : undefined}
                    >
                      <td className="px-5 py-3 font-medium text-[#1A2E26]">
                        <div>{item.name}</div>
                        <span className="font-mono text-[11px] text-[#6B7280]">{item.sku}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-[#6B7280] tabular-nums whitespace-nowrap">
                        {item.current_stock} {item.unit}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            aria-label={`Stok fisik aktual untuk ${item.name}`}
                            value={inputVal}
                            onChange={(e) =>
                              setActualCounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            className="h-8 w-24 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-right font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                          />
                          <span className="w-8 text-left text-[11px] text-[#6B7280]">
                            {item.unit}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap">
                        <span
                          className={
                            variance < 0
                              ? 'text-[#EF4444]'
                              : variance > 0
                                ? 'text-[#109A58]'
                                : 'text-[#6B7280]'
                          }
                        >
                          {variance > 0 ? `+${variance}` : variance} {item.unit}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <input
                          type="text"
                          aria-label={`Keterangan selisih untuk ${item.name}`}
                          value={itemReasons[item.id] ?? ''}
                          onChange={(e) =>
                            setItemReasons((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          placeholder={
                            hasVariance
                              ? 'Wajib catat: tumpah, rusak, expired...'
                              : 'tumpah / rusak / expired...'
                          }
                          className={`h-8 w-full min-w-[180px] rounded-lg border px-2.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none ${
                            hasVariance
                              ? 'border-[#EF4444]/40 bg-white'
                              : 'border-[#E5E7EB] bg-[#F4F6F5]/60 focus:bg-white'
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] p-5">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan umum opname (misal: pengecekan shift malam, kalibrasi espresso)..."
              className="h-10 min-w-[260px] flex-1 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] px-3.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan & Kirim Laporan WA Owner'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Opname History */}
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-semibold text-[#1A2E26]">Riwayat Pelaksanaan Opname</h2>
          <span className="text-xs text-[#6B7280] tabular-nums">{opnameLogs.length} catatan</span>
        </div>
        <div className="divide-y divide-[#E5E7EB]">
          {opnameLogs.map((log) => (
            <div
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-[#1A2E26]">{log.schedule_title}</p>
                  {log.whatsapp_sent && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#E6F5EE] px-2 py-0.5 text-[10px] font-semibold text-[#109A58]">
                      <MessageSquare className="h-2.5 w-2.5" />
                      WA Owner Terkirim
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[#6B7280]">{log.notes}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right text-xs text-[#6B7280] tabular-nums">
                  <p className="font-medium text-[#1A2E26]">
                    {log.performed_by_name} ·{' '}
                    <span
                      className={
                        log.discrepancy_count > 0
                          ? 'font-bold text-[#EF4444]'
                          : 'font-semibold text-[#109A58]'
                      }
                    >
                      {log.discrepancy_count} selisih
                    </span>
                  </p>
                  <p>{formatDateTime(log.completed_at)}</p>
                </div>
                {log.details && log.details.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDetailModalLog(log)}
                    className="inline-flex items-center gap-1 rounded-full bg-[#F4F6F5] px-3 py-1.5 text-xs font-semibold text-[#1A2E26] hover:bg-[#E6F5EE] hover:text-[#109A58] whitespace-nowrap"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Detail</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Opname Detail Modal */}
      {detailModalLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Detail Stock Opname ${detailModalLog.schedule_title}`}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-[#1A2E26]">
                  {detailModalLog.schedule_title}
                </h3>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Oleh {detailModalLog.performed_by_name} · {formatDateTime(detailModalLog.completed_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailModalLog(null)}
                aria-label="Tutup detail opname"
                className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/70 font-semibold text-[#6B7280]">
                    <th className="px-5 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Sistem</th>
                    <th className="px-4 py-3 text-right">Fisik</th>
                    <th className="px-4 py-3 text-right">Selisih</th>
                    <th className="px-5 py-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {(detailModalLog.details ?? []).map((row) => (
                    <tr key={row.inventory_item_id}>
                      <td className="px-5 py-2.5 font-medium text-[#1A2E26]">{row.item_name}</td>
                      <td className="px-4 py-2.5 text-right text-[#6B7280] tabular-nums whitespace-nowrap">
                        {row.system_stock} {row.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-[#1A2E26] tabular-nums whitespace-nowrap">
                        {row.actual_stock} {row.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums whitespace-nowrap">
                        <span
                          className={
                            row.variance < 0
                              ? 'text-[#EF4444]'
                              : row.variance > 0
                                ? 'text-[#109A58]'
                                : 'text-[#6B7280]'
                          }
                        >
                          {row.variance > 0 ? `+${row.variance}` : row.variance} {row.unit}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-[#6B7280]">{row.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-[#E5E7EB] px-6 py-3.5 text-xs">
              <span className="text-[#6B7280]">Catatan: {detailModalLog.notes}</span>
              <button
                type="button"
                onClick={() => setDetailModalLog(null)}
                className="rounded-full bg-[#109A58] px-4 py-1.5 font-semibold text-white hover:bg-[#0D8A4E]"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
