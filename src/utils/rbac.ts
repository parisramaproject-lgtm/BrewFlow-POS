import type { PageId, UserRole } from '../types';

export interface NavItemConfig {
  id: PageId;
  label: string;
  /** Alternate label shown to non-owner roles if applicable (e.g. "Menu" without HPP for Manager) */
  nonOwnerLabel?: string;
  allowedRoles: UserRole[];
  ownerOnlyFeatureNote?: string;
}

export const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    allowedRoles: ['owner', 'manager', 'cashier'],
  },
  {
    id: 'pos',
    label: 'Kasir / POS',
    allowedRoles: ['owner', 'manager', 'cashier'],
  },
  {
    id: 'orders',
    label: 'Pesanan',
    allowedRoles: ['owner', 'manager', 'cashier'],
  },
  {
    id: 'vouchers',
    label: 'Voucher & Rush Hour',
    allowedRoles: ['owner', 'manager', 'cashier'],
  },
  {
    id: 'menu-hpp',
    label: 'Menu & HPP',
    nonOwnerLabel: 'Menu',
    allowedRoles: ['owner', 'manager'],
    ownerOnlyFeatureNote: 'Kalkulator HPP hanya dapat diakses oleh Owner',
  },
  {
    id: 'inventory',
    label: 'Inventori',
    allowedRoles: ['owner', 'manager'],
  },
  {
    id: 'purchasing',
    label: 'Pembelian',
    allowedRoles: ['owner', 'manager'],
  },
  {
    id: 'stock-opname',
    label: 'Stock Opname',
    allowedRoles: ['owner', 'manager'],
  },
  {
    id: 'membership',
    label: 'Membership',
    allowedRoles: ['owner', 'manager', 'cashier'],
  },
  {
    id: 'tv-display',
    label: 'Display TV Store',
    allowedRoles: ['owner', 'manager', 'cashier'],
  },
  {
    id: 'employees',
    label: 'Karyawan',
    allowedRoles: ['owner'],
  },
  {
    id: 'settings',
    label: 'Pengaturan',
    allowedRoles: ['owner', 'manager'],
    ownerOnlyFeatureNote: 'Pengaturan Jadwal Opname hanya untuk Owner',
  },
];

export function canAccessPage(role: UserRole, page: PageId): boolean {
  const item = NAV_ITEMS.find((nav) => nav.id === page);
  if (!item) return false;
  return item.allowedRoles.includes(role);
}

export function getVisibleNavItems(role: UserRole): Array<NavItemConfig & { displayLabel: string }> {
  return NAV_ITEMS.filter((item) => item.allowedRoles.includes(role)).map((item) => ({
    ...item,
    displayLabel: role === 'owner' ? item.label : item.nonOwnerLabel ?? item.label,
  }));
}

export function canViewHPP(role: UserRole): boolean {
  return role === 'owner';
}

export function canManageEmployees(role: UserRole): boolean {
  return role === 'owner';
}

export function canManageOpnameSchedules(role: UserRole): boolean {
  return role === 'owner';
}

export function canManageWhatsAppSettings(role: UserRole): boolean {
  return role === 'owner';
}

export function canManageMembershipProgram(role: UserRole): boolean {
  return role === 'owner';
}

export function canViewFinancialProfit(role: UserRole): boolean {
  return role === 'owner';
}

export function canManageInventory(role: UserRole): boolean {
  return role === 'owner' || role === 'manager';
}

export function canManageVouchers(role: UserRole): boolean {
  return role === 'owner' || role === 'manager';
}

export function getRoleDisplayLabel(role: UserRole): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'manager':
      return 'Manager';
    case 'cashier':
      return 'Kasir';
  }
}

export function getDefaultPageForRole(_role: UserRole): PageId {
  return 'pos';
}
