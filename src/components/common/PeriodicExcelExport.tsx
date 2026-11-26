import { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Download, FileSpreadsheet, X } from 'lucide-react';
import {
  downloadExcelWorkbook,
  EXPORT_PERIOD_OPTIONS,
  formatPeriodLabel,
  resolvePeriodDateRange,
  type ExcelExportPayload,
  type ExportPeriodPreset,
} from '../../utils/excelExport';

interface PeriodicExcelExportProps {
  moduleTitle: string;
  description: string;
  buttonLabel?: string;
  defaultPreset?: Exclude<ExportPeriodPreset, 'custom'>;
  buildExport: (range: { startDate: string; endDate: string }) => ExcelExportPayload;
  testId?: string;
}

export function PeriodicExcelExport({
  moduleTitle,
  description,
  buttonLabel = 'Export Excel',
  defaultPreset = 'this_month',
  buildExport,
  testId = 'open-excel-export',
}: PeriodicExcelExportProps) {
  const [open, setOpen] = useState(false);
  const initialRange = useMemo(() => resolvePeriodDateRange(defaultPreset), [defaultPreset]);
  const [preset, setPreset] = useState<ExportPeriodPreset>(defaultPreset);
  const [startDate, setStartDate] = useState<string>(initialRange.startDate);
  const [endDate, setEndDate] = useState<string>(initialRange.endDate);
  const [downloadedFile, setDownloadedFile] = useState<string | null>(null);

  const handleOpen = () => {
    const fresh = resolvePeriodDateRange(defaultPreset);
    setPreset(defaultPreset);
    setStartDate(fresh.startDate);
    setEndDate(fresh.endDate);
    setDownloadedFile(null);
    setOpen(true);
  };

  const handleSelectPreset = (nextPreset: Exclude<ExportPeriodPreset, 'custom'>) => {
    const resolved = resolvePeriodDateRange(nextPreset);
    setPreset(nextPreset);
    setStartDate(resolved.startDate);
    setEndDate(resolved.endDate);
    setDownloadedFile(null);
  };

  const isInvalidRange = Boolean(startDate && endDate && startDate > endDate);

  const previewPayload = useMemo(() => {
    if (!open || isInvalidRange) return null;
    return buildExport({ startDate, endDate });
  }, [open, isInvalidRange, buildExport, startDate, endDate]);

  const handleDownload = () => {
    if (isInvalidRange) return;
    const payload = buildExport({ startDate, endDate });
    downloadExcelWorkbook(payload);
    setDownloadedFile(payload.fileName);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        data-testid={testId}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#1A2E26] transition-colors hover:border-[#109A58] hover:bg-[#E6F5EE] hover:text-[#109A58] whitespace-nowrap"
      >
        <FileSpreadsheet className="h-4 w-4 text-[#109A58]" />
        <span>{buttonLabel}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Export Excel ${moduleTitle}`}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-6 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#1A2E26]">
                    Export Excel — {moduleTitle}
                  </h2>
                  <p className="mt-0.5 text-xs text-[#6B7280]">{description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup dialog export Excel"
                className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 p-6">
              {/* Quick Period Presets */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#1A2E26]">
                  <Calendar className="h-3.5 w-3.5 text-[#109A58]" />
                  <span>Pilih Periode Penarikan Data</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXPORT_PERIOD_OPTIONS.map((opt) => {
                    const active = preset === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelectPreset(opt.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border-[#109A58] bg-[#E6F5EE] font-semibold text-[#109A58]'
                            : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#6B7280] hover:border-[#109A58]/50 hover:text-[#1A2E26]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Date Range Pickers */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="excel-start-date"
                    className="block text-xs font-medium text-[#6B7280]"
                  >
                    Dari Tanggal
                  </label>
                  <input
                    id="excel-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setPreset('custom');
                      setDownloadedFile(null);
                    }}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs font-medium text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="excel-end-date"
                    className="block text-xs font-medium text-[#6B7280]"
                  >
                    Sampai Tanggal
                  </label>
                  <input
                    id="excel-end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setPreset('custom');
                      setDownloadedFile(null);
                    }}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs font-medium text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              {isInvalidRange && (
                <p role="alert" className="text-xs font-medium text-[#EF4444]">
                  Tanggal mulai tidak boleh lebih besar daripada tanggal akhir.
                </p>
              )}

              {/* Live Preview Box */}
              {previewPayload && (
                <div
                  data-testid="excel-export-preview"
                  className="rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-4 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#6B7280]">Periode Terpilih</span>
                    <span className="font-semibold text-[#1A2E26] tabular-nums">
                      {formatPeriodLabel(startDate, endDate)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[#6B7280]">Data Ditemukan</span>
                    <span className="font-semibold text-[#109A58] tabular-nums">
                      {previewPayload.summaryText}
                    </span>
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-2 border-t border-[#E5E7EB] pt-2">
                    <span className="shrink-0 text-[#6B7280]">Sheet Excel</span>
                    <span className="text-right font-medium text-[#1A2E26]">
                      {previewPayload.sheets.map((s) => s.name).join(' · ')}
                    </span>
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <span className="shrink-0 text-[#6B7280]">Nama File</span>
                    <span className="truncate font-mono text-[11px] text-[#6B7280]">
                      {previewPayload.fileName}
                    </span>
                  </div>
                </div>
              )}

              {downloadedFile && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-3.5 py-2.5 text-xs font-medium text-[#109A58]"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    File <strong className="font-mono">{downloadedFile}</strong> berhasil diunduh.
                  </span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 border-t border-[#E5E7EB] bg-[#F9FAFB] px-6 py-3.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#6B7280] transition-colors hover:text-[#1A2E26]"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={isInvalidRange}
                onClick={handleDownload}
                data-testid="confirm-excel-download"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#109A58] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                <span>Unduh Excel (.xlsx)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
