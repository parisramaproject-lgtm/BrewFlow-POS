import { useEffect, useState } from 'react';
import { Coffee } from 'lucide-react';
import { AccessDenied } from './components/common/AccessDenied';
import { AppLayout } from './components/layout/AppLayout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StoreProvider } from './context/StoreContext';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { MenuHPPPage } from './pages/MenuHPPPage';
import { OrdersPage } from './pages/OrdersPage';
import { POSPage } from './pages/POSPage';
import { PurchasingPage } from './pages/PurchasingPage';
import { SettingsPage } from './pages/SettingsPage';
import { StockOpnamePage } from './pages/StockOpnamePage';
import { TVDisplayPage } from './pages/TVDisplayPage';
import { VendorsPage } from './pages/VendorsPage';
import { VouchersPage } from './pages/VouchersPage';
import type { PageId } from './types';
import { getDefaultPageForRole } from './utils/rbac';

const ACTIVE_PAGE_STORAGE_KEY = 'brewflow_active_page_v1';
const VALID_PAGES: PageId[] = [
  'dashboard',
  'pos',
  'orders',
  'vouchers',
  'menu-hpp',
  'inventory',
  'purchasing',
  'vendors',
  'stock-opname',
  'membership',
  'tv-display',
  'employees',
  'settings',
];

function loadInitialActivePage(): PageId {
  try {
    const saved = window.sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) as PageId | null;
    if (saved && VALID_PAGES.includes(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage restrictions
  }
  return 'pos';
}

function AuthenticatedApp() {
  const { user, isLoading, canAccess } = useAuth();
  const [activePage, setActivePage] = useState<PageId>(loadInitialActivePage);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (user && !canAccess(activePage)) {
      const fallback = getDefaultPageForRole(user.role);
      setActivePage(fallback);
      try {
        window.sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, fallback);
      } catch {
        // Ignore storage restrictions
      }
    }
  }, [user, activePage, canAccess]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F6F5]">
        <div className="flex items-center gap-3 text-sm font-medium text-[#1A2E26]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#109A58] text-white">
            <Coffee className="h-5 w-5" />
          </div>
          <span>Memuat BrewFlow POS...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const handleSelectPage = (page: PageId) => {
    setSearchQuery('');
    setActivePage(page);
    try {
      window.sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, page);
    } catch {
      // Ignore storage restrictions
    }
  };

  const renderPage = () => {
    if (!canAccess(activePage)) {
      return <AccessDenied onNavigateBack={handleSelectPage} />;
    }

    switch (activePage) {
      case 'dashboard':
        return <DashboardPage onNavigate={handleSelectPage} />;
      case 'pos':
        return <POSPage searchQuery={searchQuery} />;
      case 'orders':
        return <OrdersPage searchQuery={searchQuery} />;
      case 'vouchers':
        return <VouchersPage searchQuery={searchQuery} />;
      case 'menu-hpp':
        return <MenuHPPPage searchQuery={searchQuery} />;
      case 'inventory':
        return <InventoryPage searchQuery={searchQuery} />;
      case 'purchasing':
        return <PurchasingPage />;
      case 'vendors':
        return <VendorsPage searchQuery={searchQuery} onNavigate={handleSelectPage} />;
      case 'stock-opname':
        return <StockOpnamePage />;
      case 'membership':
        return <CustomersPage searchQuery={searchQuery} />;
      case 'tv-display':
        return <TVDisplayPage />;
      case 'employees':
        return <EmployeesPage onNavigate={handleSelectPage} />;
      case 'settings':
        return <SettingsPage />;
    }
  };

  return (
    <AppLayout
      activePage={activePage}
      onSelectPage={handleSelectPage}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
    >
      {renderPage()}
    </AppLayout>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </StoreProvider>
  );
}
