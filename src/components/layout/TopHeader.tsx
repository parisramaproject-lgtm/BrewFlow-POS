import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, ClipboardCheck, Menu, Search, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import type { PageId } from '../../types';
import { canAccessPage, getRoleDisplayLabel } from '../../utils/rbac';

interface TopHeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenMobileNav: () => void;
  onNavigate: (page: PageId) => void;
}

export function TopHeader({
  searchQuery,
  onSearchChange,
  onOpenMobileNav,
  onNavigate,
}: TopHeaderProps) {
  const { user, authProvider } = useAuth();
  const { notifications } = useStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [user?.photo_url]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [notifOpen]);

  if (!user) return null;

  const visibleNotifications = notifications.filter((n) => canAccessPage(user.role, n.targetPage));
  const roleLabel = getRoleDisplayLabel(user.role);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[#E5E7EB] bg-[#F4F6F5] px-4 lg:px-6">
      {/* Left: Mobile Menu Button + Rounded Search Bar */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Buka menu navigasi"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#1A2E26] hover:bg-[#E6F5EE] hover:text-[#109A58] lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative w-full max-w-md">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari menu, bahan, pesanan, atau member..."
            aria-label="Cari menu, bahan, pesanan, atau member"
            className="h-10 w-full rounded-full border border-[#E5E7EB] bg-[#FFFFFF] pl-10 pr-9 text-sm text-[#1A2E26] placeholder:text-[#6B7280] transition-colors focus:border-[#109A58] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Hapus pencarian"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#1A2E26]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Right: Notification Bell + User Profile */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        {/* Notification Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((prev) => !prev)}
            aria-label={`Notifikasi (${visibleNotifications.length} aktif)`}
            aria-expanded={notifOpen}
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#FFFFFF] text-[#1A2E26] transition-colors hover:border-[#109A58] hover:text-[#109A58] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
          >
            <Bell className="h-[18px] w-[18px]" />
            {visibleNotifications.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-bold text-white tabular-nums">
                {visibleNotifications.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              role="region"
              aria-label="Daftar Notifikasi"
              className="absolute right-0 top-12 z-40 w-80 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-2 shadow-lg sm:w-96"
            >
              <div className="flex items-center justify-between border-b border-[#E5E7EB] px-3 py-2">
                <h3 className="text-sm font-semibold text-[#1A2E26]">Notifikasi Operasional</h3>
                <span className="text-xs text-[#6B7280] tabular-nums">
                  {visibleNotifications.length} aktif
                </span>
              </div>

              {visibleNotifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[#6B7280]">
                  Semua stok dan jadwal opname dalam kondisi aman.
                </div>
              ) : (
                <div className="max-h-72 divide-y divide-[#E5E7EB] overflow-y-auto">
                  {visibleNotifications.map((notif) => (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => {
                        onNavigate(notif.targetPage);
                        setNotifOpen(false);
                      }}
                      className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[#F4F6F5]"
                    >
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          notif.type === 'opname'
                            ? 'bg-[#FEF2F2] text-[#EF4444]'
                            : 'bg-[#FFFBEB] text-[#F59E0B]'
                        }`}
                      >
                        {notif.type === 'opname' ? (
                          <ClipboardCheck className="h-4 w-4" />
                        ) : (
                          <AlertTriangle className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#1A2E26]">{notif.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-[#6B7280]">
                          {notif.message}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 rounded-full border border-[#E5E7EB] bg-[#FFFFFF] p-1 sm:py-1 sm:pl-1.5 sm:pr-3.5">
          {user.photo_url && !avatarLoadError ? (
            <img
              src={user.photo_url}
              alt={user.full_name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarLoadError(true)}
              className="h-8 w-8 shrink-0 rounded-full border border-[#E5E7EB] object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#109A58] text-xs font-bold text-white">
              {user.avatar_initials}
            </div>
          )}
          <div className="hidden text-left sm:block">
            <p className="text-xs font-semibold leading-tight text-[#1A2E26] whitespace-nowrap">
              Halo, {user.full_name}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="inline-block rounded bg-[#E6F5EE] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#109A58]">
                {roleLabel}
              </span>
              {authProvider === 'google' && (
                <span className="text-[10px] font-medium leading-none text-[#6B7280]">
                  Google
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
