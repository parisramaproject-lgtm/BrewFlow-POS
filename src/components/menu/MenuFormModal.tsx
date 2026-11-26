import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import type { MenuItemInput } from '../../context/StoreContext';
import type { Category, MenuItem } from '../../types';
import { ProductVisual } from '../common/ProductVisual';

interface MenuFormModalProps {
  isOpen: boolean;
  categories: Category[];
  editingMenu: MenuItem | null;
  onClose: () => void;
  onSubmit: (data: MenuItemInput, editingId: string | null) => Promise<void>;
}

const CATEGORY_DEFAULT_TONES: Record<string, MenuItem['visual_tone']> = {
  'cat-coffee': 'latte',
  'cat-non-coffee': 'matcha',
  'cat-food': 'savory',
  'cat-snack': 'pastry',
};

export function MenuFormModal({
  isOpen,
  categories,
  editingMenu,
  onClose,
  onSubmit,
}: MenuFormModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('cat-coffee');
  const [sellingPrice, setSellingPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [isAvailable, setIsAvailable] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingMenu) {
      setName(editingMenu.name);
      setCategoryId(editingMenu.category_id);
      setSellingPrice(String(editingMenu.selling_price));
      setDescription(editingMenu.description);
      setImageUrl(editingMenu.image_url);
      setIsAvailable(editingMenu.is_available);
    } else {
      setName('');
      setCategoryId('cat-coffee');
      setSellingPrice('');
      setDescription('');
      setImageUrl(undefined);
      setIsAvailable(true);
    }
    setErrorMsg(null);
  }, [isOpen, editingMenu]);

  if (!isOpen) return null;

  const selectableCategories = categories.filter((c) => c.id !== 'all');

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('File yang diunggah harus berupa gambar (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setErrorMsg('Ukuran gambar maksimal 3 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
        setErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = Number(sellingPrice);
    if (!name.trim()) {
      setErrorMsg('Nama menu wajib diisi.');
      return;
    }
    if (!priceNum || priceNum <= 0) {
      setErrorMsg('Harga jual harus berupa angka lebih dari 0.');
      return;
    }

    setSubmitting(true);
    await onSubmit(
      {
        name,
        category_id: categoryId,
        selling_price: priceNum,
        description: description.trim() || 'Menu pilihan BrewFlow Coffee Shop',
        visual_tone: editingMenu?.visual_tone ?? CATEGORY_DEFAULT_TONES[categoryId] ?? 'latte',
        image_url: imageUrl,
        is_available: isAvailable,
      },
      editingMenu?.id ?? null
    );
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={editingMenu ? `Edit Menu ${editingMenu.name}` : 'Tambah Menu Baru'}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#1A2E26]">
              {editingMenu ? `Edit Menu: ${editingMenu.name}` : 'Tambah Menu Baru'}
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Menu yang aktif langsung muncul pada layar Kasir / POS.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup form menu"
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#EF4444]"
            >
              {errorMsg}
            </div>
          )}

          {/* Photo Upload Row */}
          <div className="flex items-center gap-4 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]/60 p-3.5">
            <ProductVisual
              tone={editingMenu?.visual_tone ?? CATEGORY_DEFAULT_TONES[categoryId] ?? 'latte'}
              name={name || 'Preview Menu'}
              imageUrl={imageUrl}
              size="md"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-semibold text-[#1A2E26]">Foto Produk Menu</p>
              <p className="text-[11px] text-[#6B7280]">
                Format JPG/PNG/WEBP, maks. 3 MB. Ditampilkan pada kartu produk kasir.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  aria-label="Unggah foto produk menu"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EE] px-3.5 py-1.5 text-xs font-semibold text-[#109A58] hover:bg-[#D5EFE2]"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>{imageUrl ? 'Ganti Gambar' : 'Upload Gambar'}</span>
                </button>
                {imageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl(undefined);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#EF4444]"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Hapus Foto</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="menu-name" className="block text-xs font-semibold text-[#1A2E26]">
                Nama Menu *
              </label>
              <input
                id="menu-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Misal: Caramel Oat Latte"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="menu-category" className="block text-xs font-semibold text-[#1A2E26]">
                Kategori *
              </label>
              <select
                id="menu-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              >
                {selectableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="menu-price" className="block text-xs font-semibold text-[#1A2E26]">
                Harga Jual (Rp) *
              </label>
              <input
                id="menu-price"
                type="number"
                min={500}
                step={500}
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="32000"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="menu-desc" className="block text-xs font-semibold text-[#1A2E26]">
                Deskripsi Menu
              </label>
              <input
                id="menu-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Deskripsi singkat cita rasa menu..."
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#1A2E26]">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="h-4 w-4 accent-[#109A58]"
                />
                <span>Tampilkan menu sebagai tersedia di layar Kasir / POS</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E5E7EB] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-full border border-[#E5E7EB] px-5 text-xs font-semibold text-[#6B7280] hover:text-[#1A2E26]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : editingMenu ? 'Simpan Perubahan' : 'Simpan Menu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
