import {
  Boxes,
  Calculator,
  ClipboardCheck,
  Coffee,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import type { PageId } from '../../types';
import { getVisibleNavItems } from '../../utils/rbac';

interface SidebarProps {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const PAGE_ICONS: Record<PageId, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  pos: Store,
  orders: ReceiptText,
  'menu-hpp': Calculator,
  inventory: Boxes,
  purchasing: ShoppingBag,
  'stock-opname': ClipboardCheck,
  membership: Users,
  employees: UserCheck,
  settings: Settings,
};

export function Sidebar({ activePage, onSelectPage, mobileOpen, onCloseMobile }: SidebarProps) {
  const { user, logout } = useAuth();
  const { hasDueOpname, dueOpnameSchedules, settings } = useStore();

  if (!user) return null;

  const navItems = getVisibleNavItems(user.role);

  const handleSelect = (page: PageId) => {
    onSelectPage(page);
    onCloseMobile();
  };

  const sidebarContent = (
    <aside
      aria-label="Navigasi Utama"
      className="flex h-full w-[220px] shrink-0 flex-col border-r border-[#E5E7EB] bg-[#FFFFFF]"
    >
      {/* Brand Logo */}
      <div className="flex h-16 items-center justify-between border-b border-[#E5E7EB] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {settings.shopLogoUrl ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#FFFFFF]">
              <img
                src={settings.shopLogoUrl}
                alt={`Logo ${settings.shopName}`}
                className="h-full w-full object-contain p-0.5"
              />
            </div>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#109A58] text-white">
              <Coffee className="h-5 w-5" strokeWidth={2.2} />
            </div>
          )}
          <span className="truncate text-base font-bold tracking-tight text-[#1A2E26]">
            BrewFlow POS
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Tutup menu navigasi"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F4F6F5] lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const Icon = PAGE_ICONS[item.id];
          const isActive = activePage === item.id;
          const showOpnameAlert = item.id === 'stock-opname' && hasDueOpname;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#109A58] ${
                isActive
                  ? 'bg-[#E6F5EE] text-[#109A58]'
                  : 'text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]'
              }`}
            >
              <span className="flex items-center gap-3 truncate">
                <Icon
                  className={`h-[18px] w-[18px] shrink-0 ${
                    isActive ? 'text-[#109A58]' : 'text-[#6B7280] group-hover:text-[#1A2E26]'
                  }`}
                />
                <span className="truncate whitespace-nowrap">{item.displayLabel}</span>
              </span>
              {showOpnameAlert && (
                <span
                  data-testid="sidebar-opname-badge"
                  className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EF4444] px-1.5 text-[11px] font-bold text-white tabular-nums"
                  title={`${dueOpnameSchedules.length} jadwal Stock Opname jatuh tempo`}
                >
                  {dueOpnameSchedules.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Logout */}
      <div className="border-t border-[#E5E7EB] p-3">
        <button
          type="button"
          onClick={() => logout()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#6B7280] transition-colors duration-150 hover:bg-[#FEF2F2] hover:text-[#EF4444] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#EF4444]"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span className="whitespace-nowrap">Keluar</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Fixed 220px Sidebar */}
      <div className="hidden h-full lg:block">{sidebarContent}</div>

      {/* Mobile / Tablet Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-[#1A2E26]/35 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
