import { ShieldAlert } from 'lucide-react';
import type { PageId } from '../../types';

interface AccessDeniedProps {
  title?: string;
  description?: string;
  onNavigateBack: (page: PageId) => void;
}

export function AccessDenied({
  title = 'Akses Terbatas',
  description = 'Halaman ini hanya dapat diakses oleh akun dengan role Owner. Hubungi pemilik toko jika Anda memerlukan hak akses tambahan.',
  onNavigateBack,
}: AccessDeniedProps) {
  return (
    <div className="flex min-h-[420px] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FEF2F2] text-[#EF4444]">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-[#1A2E26]">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#6B7280]">{description}</p>
        <button
          type="button"
          onClick={() => onNavigateBack('pos')}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-[#109A58] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0D8A4E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
        >
          Kembali ke Kasir / POS
        </button>
      </div>
    </div>
  );
}
