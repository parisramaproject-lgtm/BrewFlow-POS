import React, { useState } from 'react';
import { NotificationWatcher } from '../common/NotificationWatcher';
import { OfflineIndicator } from '../common/OfflineIndicator';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import type { PageId } from '../../types';

const SIDEBAR_HIDDEN_STORAGE_KEY = 'brewflow_sidebar_hidden_v1';

function loadSidebarHiddenPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

interface AppLayoutProps {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  children: React.ReactNode;
}

export function AppLayout({
  activePage,
  onSelectPage,
  searchQuery,
  onSearchChange,
  children,
}: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState<boolean>(
    loadSidebarHiddenPreference
  );

  const toggleDesktopSidebar = () => {
    setDesktopSidebarHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F4F6F5] text-[#1A2E26]">
      <NotificationWatcher />
      <OfflineIndicator />

      {/* Column 1: Left Navigation Sidebar (220px, hideable on desktop + drawer on tablet/mobile) */}
      <Sidebar
        activePage={activePage}
        onSelectPage={onSelectPage}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        desktopHidden={desktopSidebarHidden}
      />

      {/* Columns 2 (+ 3 on POS): Header + Main Content Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          desktopSidebarHidden={desktopSidebarHidden}
          onToggleDesktopSidebar={toggleDesktopSidebar}
          onNavigate={onSelectPage}
        />

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
