import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'primary';

export interface ConfirmDialogProps {
  open: boolean;
  variant?: ConfirmDialogVariant;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isBusy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  variant = 'danger',
  title,
  description,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isBusy, onCancel]);

  if (!open) return null;

  const iconWrapperClass =
    variant === 'danger'
      ? 'bg-[#FEF2F2] text-[#DC2626]'
      : variant === 'warning'
        ? 'bg-[#FFFBEB] text-[#D97706]'
        : 'bg-[#E6F5EE] text-[#109A58]';

  const confirmButtonClass =
    variant === 'danger'
      ? 'bg-[#EF4444] text-white hover:bg-[#DC2626] focus-visible:outline-[#EF4444]'
      : variant === 'warning'
        ? 'bg-[#D97706] text-white hover:bg-[#B45309] focus-visible:outline-[#D97706]'
        : 'bg-[#109A58] text-white hover:bg-[#0D8A4E] focus-visible:outline-[#109A58]';

  const Icon =
    variant === 'danger' ? Trash2 : variant === 'warning' ? AlertTriangle : CheckCircle2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconWrapperClass}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="confirm-dialog-title"
                className="text-base font-semibold leading-snug text-[#1A2E26]"
              >
                {title}
              </h2>
              <div className="mt-1.5 text-xs leading-relaxed text-[#6B7280]">{description}</div>
            </div>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            aria-label="Tutup dialog konfirmasi"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F4F6F5] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#E5E7EB] pt-4">
          <button
            type="button"
            disabled={isBusy}
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className="h-9 rounded-full border border-[#E5E7EB] bg-white px-4 text-xs font-semibold text-[#6B7280] transition-colors hover:bg-[#F4F6F5] hover:text-[#1A2E26] disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isBusy}
            data-testid="confirm-dialog-confirm"
            onClick={() => void onConfirm()}
            className={`h-9 rounded-full px-5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${confirmButtonClass}`}
          >
            {isBusy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
