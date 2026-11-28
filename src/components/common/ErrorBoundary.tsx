import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Terjadi gangguan tak terduga pada tampilan aplikasi.',
    };
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F4F6F5] p-6">
          <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FEF2F2] text-[#EF4444]">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-base font-semibold text-[#1A2E26]">
              Terjadi Gangguan pada Tampilan
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-[#6B7280]">
              Transaksi dan data yang sudah tersimpan tetap aman. Silakan muat ulang halaman untuk
              melanjutkan operasional.
            </p>
            {this.state.errorMessage && (
              <p className="mt-3 rounded-xl bg-[#F4F6F5] px-3 py-2 font-mono text-[11px] text-[#6B7280] break-words">
                {this.state.errorMessage}
              </p>
            )}
            <div className="mt-5 flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={this.handleReset}
                className="h-10 rounded-full border border-[#E5E7EB] px-4 text-xs font-semibold text-[#1A2E26] hover:bg-[#F4F6F5]"
              >
                Coba Lanjutkan
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Muat Ulang Aplikasi</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
