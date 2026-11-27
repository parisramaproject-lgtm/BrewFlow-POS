import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  ShoppingBag,
  Trash2,
  Truck,
  User,
  X,
} from 'lucide-react';
import { AccessDenied } from '../components/common/AccessDenied';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { ItemCategoryType, PageId, VendorRecord } from '../types';
import {
  buildVendorOrderMessage,
  buildVendorWhatsAppUrl,
  type VendorOrderLineDraft,
} from '../utils/operationalNotifications';
import { canManageVendors } from '../utils/rbac';

interface VendorsPageProps {
  searchQuery: string;
  onNavigate: (page: PageId) => void;
}

const CATEGORY_META: Record<
  ItemCategoryType,
  { label: string; badgeClass: string }
> = {
  raw_material: {
    label: 'Bahan Baku',
    badgeClass: 'bg-[#E6F5EE] text-[#109A58]',
  },
  packaging: {
    label: 'Kemasan',
    badgeClass: 'bg-[#EFF6FF] text-[#2563EB]',
  },
  asset: {
    label: 'Aset & Mesin',
    badgeClass: 'bg-[#FEF3C7] text-[#B45309]',
  },
  operational: {
    label: 'Operasional',
    badgeClass: 'bg-[#F3F4F6] text-[#4B5563]',
  },
};

const CATEGORY_FILTER_OPTIONS: Array<{ id: ItemCategoryType | 'all'; label: string }> = [
  { id: 'all', label: 'Semua Kategori' },
  { id: 'raw_material', label: 'Bahan Baku' },
  { id: 'packaging', label: 'Kemasan' },
  { id: 'asset', label: 'Aset & Mesin' },
  { id: 'operational', label: 'Operasional' },
];

interface VendorFormState {
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  category_type: ItemCategoryType;
  supplied_items_text: string;
  address: string;
  payment_terms: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: VendorFormState = {
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  category_type: 'raw_material',
  supplied_items_text: '',
  address: '',
  payment_terms: 'Transfer H+1 / COD',
  notes: '',
  is_active: true,
};

interface OrderModalLine extends VendorOrderLineDraft {
  rowId: string;
}

export function VendorsPage({ searchQuery, onNavigate }: VendorsPageProps) {
  const { user } = useAuth();
  const {
    vendors,
    inventory,
    lowStockItems,
    settings,
    addVendor,
    updateVendor,
    deleteVendor,
    setPrefilledPurchaseVendorId,
  } = useStore();

  const [categoryFilter, setCategoryFilter] = useState<ItemCategoryType | 'all'>('all');
  const [localSearch, setLocalSearch] = useState('');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Add / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [formState, setFormState] = useState<VendorFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete & edit confirmation states (no window.confirm)
  const [confirmDeleteVendor, setConfirmDeleteVendor] = useState<VendorRecord | null>(null);
  const [pendingEditVendor, setPendingEditVendor] = useState<{
    id: string;
    payload: Omit<VendorRecord, 'id' | 'created_at'>;
  } | null>(null);

  // WhatsApp Purchase Order Modal State
  const [orderModalVendor, setOrderModalVendor] = useState<VendorRecord | null>(null);
  const [orderLines, setOrderLines] = useState<OrderModalLine[]>([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [copiedPoText, setCopiedPoText] = useState(false);

  const effectiveSearch = (localSearch || searchQuery).trim().toLowerCase();

  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      if (categoryFilter !== 'all' && vendor.category_type !== categoryFilter) {
        return false;
      }
      if (!effectiveSearch) return true;
      const haystack = [
        vendor.name,
        vendor.contact_person,
        vendor.phone,
        vendor.email ?? '',
        vendor.address ?? '',
        vendor.supplied_items.join(' '),
        CATEGORY_META[vendor.category_type].label,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(effectiveSearch);
    });
  }, [vendors, categoryFilter, effectiveSearch]);

  const stats = useMemo(() => {
    const activeCount = vendors.filter((v) => v.is_active).length;
    const rawMaterialCount = vendors.filter((v) => v.category_type === 'raw_material').length;
    const packagingAssetCount = vendors.filter(
      (v) => v.category_type === 'packaging' || v.category_type === 'asset'
    ).length;
    return {
      total: vendors.length,
      active: activeCount,
      rawMaterial: rawMaterialCount,
      packagingAsset: packagingAssetCount,
    };
  }, [vendors]);

  const generatedPoMessage = useMemo(() => {
    if (!orderModalVendor) return '';
    const validLines = orderLines
      .filter((l) => l.itemName.trim() && l.quantity > 0)
      .map((l) => ({
        itemName: l.itemName.trim(),
        quantity: l.quantity,
        unit: l.unit.trim() || 'pcs',
      }));
    return buildVendorOrderMessage({
      vendor: orderModalVendor,
      shopName: settings.shopName,
      items: validLines,
      notes: orderNotes,
    });
  }, [orderModalVendor, orderLines, orderNotes, settings.shopName]);

  const generatedWaUrl = useMemo(() => {
    if (!orderModalVendor) return null;
    return buildVendorWhatsAppUrl(orderModalVendor.phone, generatedPoMessage);
  }, [orderModalVendor, generatedPoMessage]);

  if (!user || !canManageVendors(user.role)) {
    return <AccessDenied onNavigateBack={onNavigate} />;
  }

  const showTempBanner = (message: string) => {
    setStatusBanner(message);
    window.setTimeout(() => setStatusBanner(null), 5000);
  };

  const openAddModal = () => {
    setEditingVendorId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (vendor: VendorRecord) => {
    setEditingVendorId(vendor.id);
    setFormState({
      name: vendor.name,
      contact_person: vendor.contact_person,
      phone: vendor.phone,
      email: vendor.email ?? '',
      category_type: vendor.category_type,
      supplied_items_text: vendor.supplied_items.join(', '),
      address: vendor.address ?? '',
      payment_terms: vendor.payment_terms ?? '',
      notes: vendor.notes ?? '',
      is_active: vendor.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveVendor = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formState.name.trim();
    const cleanPic = formState.contact_person.trim();
    const cleanPhone = formState.phone.trim();

    if (!cleanName || !cleanPic || !cleanPhone) {
      setFormError('Nama vendor, nama kontak (PIC), dan nomor WhatsApp/telepon wajib diisi.');
      return;
    }

    const parsedItems = formState.supplied_items_text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      name: cleanName,
      contact_person: cleanPic,
      phone: cleanPhone,
      email: formState.email.trim() || undefined,
      category_type: formState.category_type,
      supplied_items: parsedItems,
      address: formState.address.trim() || undefined,
      payment_terms: formState.payment_terms.trim() || undefined,
      notes: formState.notes.trim() || undefined,
      is_active: formState.is_active,
    };

    if (editingVendorId) {
      setPendingEditVendor({ id: editingVendorId, payload });
      return;
    }

    addVendor(payload);
    showTempBanner(`Vendor baru "${cleanName}" berhasil ditambahkan ke daftar kontak.`);
    setModalOpen(false);
    setEditingVendorId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteVendor) return;
    const removedName = confirmDeleteVendor.name;
    deleteVendor(confirmDeleteVendor.id);
    setConfirmDeleteVendor(null);
    showTempBanner(`Vendor "${removedName}" dihapus dari daftar kontak.`);
  };

  const openWhatsAppOrderModal = (vendor: VendorRecord) => {
    setOrderModalVendor(vendor);
    setCopiedPoText(false);
    setOrderNotes('');

    // Suggest low-stock inventory items matching this vendor's category, otherwise use supplied_items
    const matchingLowStock = lowStockItems.filter(
      (item) => item.category_type === vendor.category_type
    );

    if (matchingLowStock.length > 0) {
      setOrderLines(
        matchingLowStock.slice(0, 3).map((item, idx) => ({
          rowId: `po-line-${Date.now()}-${idx}`,
          itemName: item.name,
          quantity: Math.max(item.min_stock_threshold * 2, 10),
          unit: item.unit,
        }))
      );
      return;
    }

    if (vendor.supplied_items.length > 0) {
      setOrderLines(
        vendor.supplied_items.slice(0, 2).map((itemName, idx) => {
          const matchedInv = inventory.find((inv) =>
            inv.name.toLowerCase().includes(itemName.toLowerCase())
          );
          return {
            rowId: `po-line-${Date.now()}-${idx}`,
            itemName,
            quantity: matchedInv ? Math.max(matchedInv.min_stock_threshold, 10) : 10,
            unit: matchedInv?.unit ?? (vendor.category_type === 'raw_material' ? 'gr' : 'pcs'),
          };
        })
      );
      return;
    }

    setOrderLines([
      {
        rowId: `po-line-${Date.now()}-0`,
        itemName: '',
        quantity: 10,
        unit: vendor.category_type === 'raw_material' ? 'kg' : 'pcs',
      },
    ]);
  };

  const handleAddOrderLine = () => {
    setOrderLines((prev) => [
      ...prev,
      {
        rowId: `po-line-${Date.now()}-${prev.length}`,
        itemName: '',
        quantity: 1,
        unit: 'pcs',
      },
    ]);
  };

  const handleUpdateOrderLine = (
    rowId: string,
    field: 'itemName' | 'quantity' | 'unit',
    value: string
  ) => {
    setOrderLines((prev) =>
      prev.map((line) => {
        if (line.rowId !== rowId) return line;
        if (field === 'quantity') {
          return { ...line, quantity: Math.max(0, Number(value) || 0) };
        }
        return { ...line, [field]: value };
      })
    );
  };

  const handleRemoveOrderLine = (rowId: string) => {
    setOrderLines((prev) => (prev.length > 1 ? prev.filter((l) => l.rowId !== rowId) : prev));
  };

  const handleCopyPoMessage = async () => {
    try {
      await navigator.clipboard.writeText(generatedPoMessage);
      setCopiedPoText(true);
      window.setTimeout(() => setCopiedPoText(false), 2500);
    } catch {
      setCopiedPoText(false);
    }
  };

  const handleJumpToPurchase = (vendor: VendorRecord) => {
    setPrefilledPurchaseVendorId(vendor.id);
    onNavigate('purchasing');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">
            Vendor &amp; Kontak Supplier
          </h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Kelola direktori pemasok bahan baku, kemasan, dan mesin untuk mempermudah pemesanan
            ulang langsung via WhatsApp dan pencatatan pembelian.
          </p>
        </div>

        <button
          type="button"
          data-testid="add-vendor-button"
          onClick={openAddModal}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>Tambah Vendor</span>
        </button>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#6B7280]">Total Vendor Terdaftar</p>
            <Building2 className="h-4 w-4 text-[#109A58]" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">{stats.total}</p>
          <p className="mt-1 text-[11px] text-[#6B7280]">
            {stats.active} aktif siap dipesan kapan saja
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#6B7280]">Pemasok Bahan Baku</p>
            <Truck className="h-4 w-4 text-[#109A58]" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-[#109A58] tabular-nums">
            {stats.rawMaterial}
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">Kopi, susu, sirup, matcha &amp; bahan utama</p>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#6B7280]">Kemasan, Aset &amp; Lainnya</p>
            <ShoppingBag className="h-4 w-4 text-[#2563EB]" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {stats.packagingAsset}
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">
            Cup, lid, paper bag, mesin espresso &amp; servis
          </p>
        </div>
      </div>

      {statusBanner && (
        <div
          role="status"
          data-testid="vendor-status-banner"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{statusBanner}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            aria-label="Tutup notifikasi vendor"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_FILTER_OPTIONS.map((opt) => {
            const active = categoryFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setCategoryFilter(opt.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[#109A58] text-white'
                    : 'bg-[#F4F6F5] text-[#6B7280] hover:bg-[#E6F5EE] hover:text-[#109A58]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <input
          type="search"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Cari nama vendor, PIC, nomor WA, atau produk..."
          aria-label="Cari vendor"
          className="h-9 w-full rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] px-3.5 text-xs text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:bg-white focus:outline-none sm:w-72"
        />
      </div>

      {/* Vendor Cards Grid */}
      {filteredVendors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D1D5DB] bg-[#FFFFFF] px-6 py-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-[#9CA3AF]" />
          <p className="mt-3 text-sm font-semibold text-[#1A2E26]">
            Belum ada vendor yang cocok
          </p>
          <p className="mt-1 text-xs text-[#6B7280]">
            Tambahkan kontak supplier baru agar pemesanan stok ke vendor jauh lebih cepat.
          </p>
          <button
            type="button"
            onClick={openAddModal}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tambah Vendor Pertama</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredVendors.map((vendor) => {
            const catMeta = CATEGORY_META[vendor.category_type];
            return (
              <article
                key={vendor.id}
                data-testid={`vendor-card-${vendor.id}`}
                className="flex flex-col justify-between rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 transition-colors hover:border-[#109A58]/40"
              >
                <div className="space-y-3">
                  {/* Top Row: Name + Category + Actions */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-[#1A2E26]">
                          {vendor.name}
                        </h2>
                        {!vendor.is_active && (
                          <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#EF4444]">
                            Nonaktif
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${catMeta.badgeClass}`}
                        >
                          {catMeta.label}
                        </span>
                        {vendor.payment_terms && (
                          <span className="text-[11px] font-medium text-[#6B7280]">
                            Termin: {vendor.payment_terms}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(vendor)}
                        aria-label={`Edit vendor ${vendor.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteVendor(vendor)}
                        aria-label={`Hapus vendor ${vendor.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Contact Details */}
                  <div className="space-y-1.5 rounded-xl bg-[#F4F6F5] p-3 text-xs text-[#1A2E26]">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
                      <span className="font-medium">PIC: {vendor.contact_person}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-[#109A58]" />
                      <span className="font-mono font-semibold tabular-nums">{vendor.phone}</span>
                    </div>
                    {vendor.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
                        <span className="truncate text-[#4B5563]">{vendor.email}</span>
                      </div>
                    )}
                    {vendor.address && (
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
                        <span className="text-[#4B5563]">{vendor.address}</span>
                      </div>
                    )}
                  </div>

                  {/* Supplied Items */}
                  {vendor.supplied_items.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-[#6B7280]">Produk yang Disuplai:</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {vendor.supplied_items.map((item) => (
                          <span
                            key={item}
                            className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#1A2E26]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {vendor.notes && (
                    <p className="text-[11px] leading-relaxed text-[#6B7280]">
                      Catatan: {vendor.notes}
                    </p>
                  )}
                </div>

                {/* Action Footer */}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E5E7EB] pt-3.5">
                  <button
                    type="button"
                    data-testid={`vendor-wa-btn-${vendor.id}`}
                    onClick={() => openWhatsAppOrderModal(vendor)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#109A58] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>Pesan via WA</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`vendor-purchase-btn-${vendor.id}`}
                    onClick={() => handleJumpToPurchase(vendor)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-xs font-semibold text-[#1A2E26] transition-colors hover:border-[#109A58] hover:bg-[#E6F5EE] hover:text-[#109A58] whitespace-nowrap"
                  >
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>Catat Pembelian</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add / Edit Vendor Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3.5">
              <div>
                <h2 id="vendor-modal-title" className="text-base font-semibold text-[#1A2E26]">
                  {editingVendorId ? 'Edit Kontak Vendor' : 'Tambah Vendor / Supplier Baru'}
                </h2>
                <p className="text-xs text-[#6B7280]">
                  Simpan kontak pemasok agar pemesanan stok &amp; pencatatan nota lebih cepat.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Tutup modal vendor"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVendor} className="mt-4 space-y-3.5">
              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#EF4444]"
                >
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="vendor-name"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Nama Vendor / Perusahaan *
                  </label>
                  <input
                    id="vendor-name"
                    type="text"
                    required
                    value={formState.name}
                    onChange={(e) => setFormState((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Contoh: PT Kopi Nusantara Roastery"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="vendor-pic"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Nama Kontak / PIC *
                  </label>
                  <input
                    id="vendor-pic"
                    type="text"
                    required
                    value={formState.contact_person}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, contact_person: e.target.value }))
                    }
                    placeholder="Contoh: Pak Hendra / Ibu Maya"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="vendor-phone"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    No. WhatsApp / Telepon *
                  </label>
                  <input
                    id="vendor-phone"
                    type="tel"
                    required
                    value={formState.phone}
                    onChange={(e) => setFormState((s) => ({ ...s, phone: e.target.value }))}
                    placeholder="0812-xxxx-xxxx"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="vendor-email"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Email (Opsional)
                  </label>
                  <input
                    id="vendor-email"
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState((s) => ({ ...s, email: e.target.value }))}
                    placeholder="sales@supplier.co.id"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="vendor-category"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Kategori Suplai
                  </label>
                  <select
                    id="vendor-category"
                    value={formState.category_type}
                    onChange={(e) =>
                      setFormState((s) => ({
                        ...s,
                        category_type: e.target.value as ItemCategoryType,
                      }))
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  >
                    <option value="raw_material">Bahan Baku</option>
                    <option value="packaging">Kemasan</option>
                    <option value="asset">Aset &amp; Mesin</option>
                    <option value="operational">Operasional</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="vendor-terms"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Termin Pembayaran
                  </label>
                  <input
                    id="vendor-terms"
                    type="text"
                    value={formState.payment_terms}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, payment_terms: e.target.value }))
                    }
                    placeholder="Contoh: COD / Transfer H+7"
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="vendor-items"
                  className="block text-xs font-semibold text-[#1A2E26]"
                >
                  Produk yang Disuplai (pisahkan dengan koma)
                </label>
                <input
                  id="vendor-items"
                  type="text"
                  value={formState.supplied_items_text}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, supplied_items_text: e.target.value }))
                  }
                  placeholder="Contoh: Susu Oat Barista, Susu Full Cream, Whipping Cream"
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="vendor-address"
                  className="block text-xs font-semibold text-[#1A2E26]"
                >
                  Alamat Gudang / Kantor (Opsional)
                </label>
                <input
                  id="vendor-address"
                  type="text"
                  value={formState.address}
                  onChange={(e) => setFormState((s) => ({ ...s, address: e.target.value }))}
                  placeholder="Contoh: Jl. Industri Kopi No. 18, Jakarta Selatan"
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="vendor-notes"
                  className="block text-xs font-semibold text-[#1A2E26]"
                >
                  Catatan Pemesanan (Opsional)
                </label>
                <textarea
                  id="vendor-notes"
                  rows={2}
                  value={formState.notes}
                  onChange={(e) => setFormState((s) => ({ ...s, notes: e.target.value }))}
                  placeholder="Contoh: Minimal order 5 dus, pengiriman setiap Selasa & Jumat."
                  className="mt-1 w-full rounded-xl border border-[#E5E7EB] p-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-[#1A2E26]">
                <input
                  type="checkbox"
                  checked={formState.is_active}
                  onChange={(e) => setFormState((s) => ({ ...s, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-[#D1D5DB] text-[#109A58] focus:ring-[#109A58]"
                />
                <span>Vendor aktif (tampilkan di pilihan cepat form Pembelian)</span>
              </label>

              <div className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-full border border-[#E5E7EB] px-4 py-2 text-xs font-semibold text-[#6B7280] hover:bg-[#F4F6F5]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  data-testid="save-vendor-submit"
                  className="rounded-full bg-[#109A58] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
                >
                  {editingVendorId ? 'Simpan Perubahan' : 'Simpan Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Purchase Order Builder Modal */}
      {orderModalVendor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-wa-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3.5">
              <div>
                <h2 id="vendor-wa-modal-title" className="text-base font-semibold text-[#1A2E26]">
                  Pesan Barang ke {orderModalVendor.name}
                </h2>
                <p className="text-xs text-[#6B7280]">
                  PIC: {orderModalVendor.contact_person} · WA: {orderModalVendor.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrderModalVendor(null)}
                aria-label="Tutup modal pemesanan WhatsApp"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Editable Order Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[#1A2E26]">Daftar Barang yang Dipesan</p>
                  <button
                    type="button"
                    onClick={handleAddOrderLine}
                    className="inline-flex items-center gap-1 rounded-full bg-[#E6F5EE] px-3 py-1 text-[11px] font-semibold text-[#109A58] hover:bg-[#D5EFE2]"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Tambah Barang</span>
                  </button>
                </div>

                {orderLines.map((line, idx) => (
                  <div key={line.rowId} className="grid grid-cols-12 gap-2">
                    <input
                      type="text"
                      aria-label={`Nama barang #${idx + 1}`}
                      value={line.itemName}
                      onChange={(e) => handleUpdateOrderLine(line.rowId, 'itemName', e.target.value)}
                      placeholder="Nama barang..."
                      className="col-span-6 h-9 rounded-lg border border-[#E5E7EB] px-2.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={1}
                      aria-label={`Jumlah barang #${idx + 1}`}
                      value={line.quantity}
                      onChange={(e) => handleUpdateOrderLine(line.rowId, 'quantity', e.target.value)}
                      className="col-span-2 h-9 rounded-lg border border-[#E5E7EB] px-2.5 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                    <input
                      type="text"
                      aria-label={`Satuan barang #${idx + 1}`}
                      value={line.unit}
                      onChange={(e) => handleUpdateOrderLine(line.rowId, 'unit', e.target.value)}
                      placeholder="kg / pcs"
                      className="col-span-3 h-9 rounded-lg border border-[#E5E7EB] px-2.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={orderLines.length <= 1}
                      onClick={() => handleRemoveOrderLine(line.rowId)}
                      aria-label={`Hapus baris barang #${idx + 1}`}
                      className="col-span-1 flex h-9 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#EF4444] disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label
                  htmlFor="vendor-po-notes"
                  className="block text-xs font-semibold text-[#1A2E26]"
                >
                  Catatan Tambahan untuk Vendor (Opsional)
                </label>
                <input
                  id="vendor-po-notes"
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Contoh: Mohon kirim besok sebelum jam 10.00 WIB."
                  className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              {/* Preview Box */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[#1A2E26]">Pratinjau Pesan WhatsApp</p>
                  <button
                    type="button"
                    onClick={handleCopyPoMessage}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#109A58] hover:underline"
                  >
                    {copiedPoText ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Tersalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Salin Teks</span>
                      </>
                    )}
                  </button>
                </div>
                <pre
                  data-testid="vendor-wa-preview"
                  className="mt-1.5 whitespace-pre-wrap rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-3.5 font-sans text-xs leading-relaxed text-[#1A2E26]"
                >
                  {generatedPoMessage}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  onClick={() => {
                    const v = orderModalVendor;
                    setOrderModalVendor(null);
                    handleJumpToPurchase(v);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E7EB] px-4 py-2 text-xs font-semibold text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58]"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>Lanjut Catat di Pembelian</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderModalVendor(null)}
                    className="rounded-full border border-[#E5E7EB] px-4 py-2 text-xs font-semibold text-[#6B7280] hover:bg-[#F4F6F5]"
                  >
                    Tutup
                  </button>
                  {generatedWaUrl && (
                    <a
                      href={generatedWaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="vendor-wa-send-link"
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span>Kirim via WhatsApp</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete & Edit Confirmation Dialogs */}
      <ConfirmDialog
        open={Boolean(confirmDeleteVendor)}
        variant="danger"
        title="Hapus Kontak Vendor?"
        description={
          confirmDeleteVendor && (
            <span>
              Kontak <strong className="text-[#1A2E26]">{confirmDeleteVendor.name}</strong> akan
              dihapus dari direktori vendor. Riwayat transaksi pembelian sebelumnya tetap tersimpan.
            </span>
          )
        }
        confirmLabel="Ya, Hapus Vendor"
        cancelLabel="Batal"
        onCancel={() => setConfirmDeleteVendor(null)}
        onConfirm={handleConfirmDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingEditVendor)}
        variant="warning"
        title="Konfirmasi Perubahan Kontak Vendor"
        description={
          pendingEditVendor && (
            <span>
              Simpan perubahan data untuk vendor{' '}
              <strong className="text-[#1A2E26]">{pendingEditVendor.payload.name}</strong>?
            </span>
          )
        }
        confirmLabel="Ya, Simpan Perubahan"
        cancelLabel="Batal"
        onCancel={() => setPendingEditVendor(null)}
        onConfirm={() => {
          if (!pendingEditVendor) return;
          updateVendor(pendingEditVendor.id, pendingEditVendor.payload);
          showTempBanner(`Kontak vendor "${pendingEditVendor.payload.name}" berhasil diperbarui.`);
          setPendingEditVendor(null);
          setModalOpen(false);
          setEditingVendorId(null);
          setFormState(EMPTY_FORM);
          setFormError(null);
        }}
      />
    </div>
  );
}
