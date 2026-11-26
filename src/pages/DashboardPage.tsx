import { AlertTriangle, ArrowRight, ClipboardCheck, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { PageId } from '../types';
import { formatDateTime, formatPercent, formatRupiah } from '../utils/format';
import { calculateMenuHpp } from '../utils/posCalculations';
import { canAccessPage, canViewFinancialProfit } from '../utils/rbac';

interface DashboardPageProps {
  onNavigate: (page: PageId) => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { user } = useAuth();
  const { orders, menus, inventory, customers, lowStockItems, hasDueOpname, dueOpnameSchedules } =
    useStore();

  if (!user) return null;

  const completedOrders = orders.filter((o) => o.status === 'completed');
  const totalRevenue = completedOrders.reduce((sum, o) => sum + o.total_amount, 0);
  const avgOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;

  // Owner-only profit calculation based on BOM HPP
  const canSeeProfit = canViewFinancialProfit(user.role);
  const menuById = new Map(menus.map((m) => [m.id, m]));
  let totalEstimatedHpp = 0;
  if (canSeeProfit) {
    for (const order of completedOrders) {
      for (const item of order.items) {
        const menu = menuById.get(item.menu_id);
        if (menu) {
          const hpp = calculateMenuHpp(menu.selling_price, menu.recipes, inventory);
          totalEstimatedHpp += hpp.totalHpp * item.quantity;
        }
      }
    }
  }
  const estimatedGrossProfit = Math.max(0, totalRevenue - totalEstimatedHpp);
  const grossMarginPercent = totalRevenue > 0 ? (estimatedGrossProfit / totalRevenue) * 100 : 0;

  const primaryDueSchedule = dueOpnameSchedules[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Ringkasan Operasional</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Pantau performa penjualan harian dan status operasional kedai Anda.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('pos')}
          className="inline-flex items-center gap-2 rounded-full bg-[#109A58] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
        >
          <span>Buka Layar Kasir</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Prominent Scheduled Stock Opname Alert Banner (Owner & Manager) */}
      {hasDueOpname && primaryDueSchedule && canAccessPage(user.role, 'stock-opname') && (
        <div
          role="alert"
          data-testid="dashboard-opname-banner"
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-[#EF4444]/40 bg-[#FEF2F2] px-5 py-4 shadow-xs"
        >
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EF4444] text-white">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-[#EF4444]/15 px-2 py-0.5 text-[11px] font-bold text-[#EF4444]">
                  {dueOpnameSchedules.length} JADWAL JATUH TEMPO
                </span>
                <h2 className="text-sm font-bold text-[#1A2E26]">
                  Waktunya Stock Opname: {primaryDueSchedule.title}
                </h2>
              </div>
              <p className="mt-1 text-xs text-[#4B5563]">
                Jadwal pukul <strong className="text-[#1A2E26]">{primaryDueSchedule.execution_time} WIB</strong> belum diselesaikan hari ini
                {dueOpnameSchedules.length > 1
                  ? ` (+${dueOpnameSchedules.length - 1} jadwal lain menunggu pengecekan)`
                  : ''}
                . Segera input stok fisik agar selisih tercatat dan terkirim ke Owner.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('stock-opname')}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#EF4444] px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#DC2626] whitespace-nowrap"
          >
            <span>Kerjakan Stock Opname</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
          <p className="text-xs font-medium text-[#6B7280]">Penjualan Hari Ini</p>
          <p className="mt-2 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {formatRupiah(totalRevenue)}
          </p>
          <p className="mt-1.5 text-xs text-[#109A58]">
            {completedOrders.length} transaksi selesai
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
          <p className="text-xs font-medium text-[#6B7280]">Rata-rata Transaksi</p>
          <p className="mt-2 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {formatRupiah(avgOrderValue)}
          </p>
          <p className="mt-1.5 text-xs text-[#6B7280]">Per struk pembayaran</p>
        </div>

        {canSeeProfit ? (
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[#6B7280]">Estimasi Laba Kotor (Owner)</p>
              <TrendingUp className="h-4 w-4 text-[#109A58]" />
            </div>
            <p className="mt-2 text-2xl font-bold text-[#109A58] tabular-nums">
              {formatRupiah(estimatedGrossProfit)}
            </p>
            <p className="mt-1.5 text-xs text-[#6B7280] tabular-nums">
              Margin {formatPercent(grossMarginPercent)} berbasis resep HPP
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
            <p className="text-xs font-medium text-[#6B7280]">Member Terdaftar</p>
            <p className="mt-2 text-2xl font-bold text-[#1A2E26] tabular-nums">
              {customers.length}
            </p>
            <p className="mt-1.5 text-xs text-[#109A58]">Program loyalitas aktif</p>
          </div>
        )}

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
          <p className="text-xs font-medium text-[#6B7280]">
            {canAccessPage(user.role, 'inventory') ? 'Peringatan Stok Menipis' : 'Menu Aktif'}
          </p>
          <p className="mt-2 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {canAccessPage(user.role, 'inventory') ? lowStockItems.length : menus.length}
          </p>
          <p className="mt-1.5 text-xs text-[#6B7280]">
            {canAccessPage(user.role, 'inventory')
              ? 'Item di bawah batas minimum'
              : 'Siap dipesan di POS'}
          </p>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Recent Orders */}
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] lg:col-span-8">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
            <h2 className="text-base font-semibold text-[#1A2E26]">Transaksi Terbaru</h2>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="text-xs font-semibold text-[#109A58] hover:underline"
            >
              Lihat Semua
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-xs font-medium text-[#6B7280]">
                  <th className="px-5 py-3">No. Pesanan</th>
                  <th className="px-5 py-3">Pelanggan</th>
                  <th className="px-5 py-3">Waktu</th>
                  <th className="px-5 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {orders.slice(0, 5).map((order) => (
                  <tr key={order.id} className="hover:bg-[#F4F6F5]/60">
                    <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#1A2E26]">
                      {order.order_number}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#1A2E26]">
                      {order.customer_name || 'Walk-in Guest'}
                      <span className="ml-2 text-[#6B7280]">· {order.table_number}</span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#6B7280] tabular-nums">
                      {formatDateTime(order.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right text-xs font-semibold text-[#1A2E26] tabular-nums">
                      {formatRupiah(order.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side Operational Panel */}
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] lg:col-span-4">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
            <h2 className="text-base font-semibold text-[#1A2E26]">
              {canAccessPage(user.role, 'inventory') ? 'Stok Perlu Restock' : 'Member Teratas'}
            </h2>
            {canAccessPage(user.role, 'inventory') ? (
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-[#109A58] hover:underline"
              >
                Inventori
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('membership')}
                className="text-xs font-semibold text-[#109A58] hover:underline"
              >
                Membership
              </button>
            )}
          </div>

          <div className="divide-y divide-[#E5E7EB] px-5">
            {canAccessPage(user.role, 'inventory') ? (
              lowStockItems.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#6B7280]">
                  Semua stok bahan baku di atas batas minimum.
                </p>
              ) : (
                lowStockItems.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" />
                      <div>
                        <p className="text-xs font-semibold text-[#1A2E26]">{item.name}</p>
                        <p className="mt-0.5 text-[11px] text-[#6B7280] tabular-nums">
                          Min. {item.min_stock_threshold} {item.unit}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-[#EF4444] tabular-nums whitespace-nowrap">
                      {item.current_stock} {item.unit}
                    </span>
                  </div>
                ))
              )
            ) : (
              customers.slice(0, 4).map((cust) => (
                <div key={cust.id} className="flex items-center justify-between py-3.5">
                  <div>
                    <p className="text-xs font-semibold text-[#1A2E26]">{cust.name}</p>
                    <p className="text-[11px] text-[#6B7280]">{cust.tier}</p>
                  </div>
                  <span className="text-xs font-semibold text-[#109A58] tabular-nums">
                    {cust.points} poin
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
