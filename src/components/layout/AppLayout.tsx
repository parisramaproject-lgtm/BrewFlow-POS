import React, { useState } from 'react';
import { NotificationWatcher } from '../common/NotificationWatcher';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import type { PageId } from '../../types';

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

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F4F6F5] text-[#1A2E26]">
      <NotificationWatcher />

      {/* Column 1: Left Navigation Sidebar (220px) */}
      <Sidebar
        activePage={activePage}
        onSelectPage={onSelectPage}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      {/* Columns 2 (+ 3 on POS): Header + Main Content Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onNavigate={onSelectPage}
        />

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
