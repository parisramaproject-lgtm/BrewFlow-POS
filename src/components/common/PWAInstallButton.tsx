import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Automatically suppress when running inside installed standalone PWA
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        data-testid="pwa-install-button"
        title="Pasang BrewFlow POS ke Home Screen perangkat Anda"
        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#109A58]/35 bg-[#E6F5EE] px-3 text-xs font-semibold text-[#109A58] transition-colors hover:bg-[#109A58] hover:text-white whitespace-nowrap"
      >
        {isInstallable ? (
          <Download className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="hidden xl:inline">Install App</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Panduan Pasang BrewFlow POS ke Home Screen"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#1A2E26]">
                    Pasang BrewFlow ke Home Screen
                  </h3>
                  <p className="text-xs text-[#6B7280]">
                    Akses cepat layar penuh seperti aplikasi native + notifikasi langsung.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Tutup panduan instalasi"
                className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 rounded-xl bg-[#F4F6F5] p-4 text-xs leading-relaxed text-[#1A2E26]">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#109A58]">1.</span>
                  <span>
                    Buka BrewFlow POS di <strong>Safari</strong>, lalu ketuk tombol{' '}
                    <span className="inline-flex items-center gap-0.5 rounded bg-white px-1.5 py-0.5 font-semibold">
                      <Share className="h-3 w-3 text-[#109A58]" /> Bagikan (Share)
                    </span>{' '}
                    di toolbar bawah.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#109A58]">2.</span>
                  <span>
                    Gulir ke bawah dan pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#109A58]">3.</span>
                  <span>
                    Ketuk <strong>Tambah</strong>, lalu buka aplikasi dari ikon BrewFlow di layar
                    utama dan aktifkan izin Notifikasi pada ikon lonceng.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 rounded-xl bg-[#F4F6F5] p-4 text-xs leading-relaxed text-[#1A2E26]">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#109A58]">1.</span>
                  <span>
                    Pada <strong>Chrome / Edge (Android atau Desktop)</strong>, buka menu browser
                    (titik tiga di pojok kanan atas) atau klik ikon <strong>Install</strong> di
                    kolom alamat.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#109A58]">2.</span>
                  <span>
                    Pilih <strong>Tambahkan ke Layar Utama / Install BrewFlow POS</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#109A58]">3.</span>
                  <span>
                    Setelah terpasang, klik tombol lonceng notifikasi di kanan atas untuk
                    mengaktifkan notifikasi push stok, orderan masuk, dan pesan Owner.
                  </span>
                </li>
              </ol>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="h-9 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
