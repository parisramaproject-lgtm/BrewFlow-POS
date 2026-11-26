import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Bluetooth,
  CalendarClock,
  CheckCircle2,
  Coffee,
  ImagePlus,
  Lock,
  MessageSquare,
  Monitor,
  Percent,
  Printer,
  Send,
  Store,
  Terminal,
  Trash2,
  Usb,
  Wifi,
} from 'lucide-react';
import { PrintableReceipt } from '../components/common/PrintableReceipt';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import {
  connectBluetoothThermalPrinter,
  connectSerialThermalPrinter,
  disconnectBluetoothThermalPrinter,
  getActiveHardwareStatus,
  isRunningInIframe,
  isWebBluetoothSupported,
  isWebSerialSupported,
  printOrderReceipt,
} from '../services/thermalPrinterService';
import type {
  ItemCategoryType,
  OpnameFrequency,
  OrderRecord,
  StoreSettings,
  ThermalPrinterConnectionType,
  WhatsAppEventType,
} from '../types';
import { formatDateTime } from '../utils/format';
import {
  getCategoryTargetLabel,
  getFrequencyDescription,
  INDONESIAN_DAYS,
} from '../utils/opnameScheduler';

const EVENT_TYPE_LABELS: Record<WhatsAppEventType, string> = {
  opname_reminder: 'Pengingat Opname',
  low_stock_alert: 'Alert Stok Menipis',
  pos_receipt: 'Struk Digital POS',
  opname_report: 'Laporan Opname Owner',
  test_message: 'Tes Koneksi',
};

export function SettingsPage() {
  const { authMode, canSeeOpnameScheduleSettings } = useAuth();
  const {
    settings,
    opnameSchedules,
    dueOpnameSchedules,
    whatsappLogs,
    updateSettings,
    addOpnameSchedule,
    toggleOpnameSchedule,
    deleteOpnameSchedule,
    sendWhatsAppMessage,
  } = useStore();
  const liveSupabaseEnabled = authMode === 'supabase';

  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<'store' | 'printer' | 'schedule' | 'whatsapp'>(
    'store'
  );

  // Store, Tax & Receipt Form Draft State
  const [shopName, setShopName] = useState(settings.shopName ?? '');
  const [address, setAddress] = useState(settings.address ?? '');
  const [phone, setPhone] = useState(settings.phone ?? '');
  const [customerServiceContact, setCustomerServiceContact] = useState(
    settings.customerServiceContact ?? ''
  );
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(settings.shopLogoUrl ?? null);
  const [taxEnabled, setTaxEnabled] = useState(Boolean(settings.taxEnabled));
  const [taxPercent, setTaxPercent] = useState(String(settings.taxPercent ?? 10));
  const [taxLabel, setTaxLabel] = useState(settings.taxLabel ?? 'PB1 / Pajak Restoran');
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<'58mm' | '80mm'>(
    settings.receiptPaperWidth ?? '58mm'
  );
  const [receiptHeaderText, setReceiptHeaderText] = useState(settings.receiptHeaderText ?? '');
  const [receiptFooterText, setReceiptFooterText] = useState(settings.receiptFooterText ?? '');
  const [receiptShowLogo, setReceiptShowLogo] = useState(Boolean(settings.receiptShowLogo));
  const [receiptShowCashierAndTable, setReceiptShowCashierAndTable] = useState(
    Boolean(settings.receiptShowCashierAndTable)
  );
  const [receiptShowMemberInfo, setReceiptShowMemberInfo] = useState(
    Boolean(settings.receiptShowMemberInfo)
  );
  const [receiptShowCustomerService, setReceiptShowCustomerService] = useState(
    Boolean(settings.receiptShowCustomerService)
  );
  const [logoError, setLogoError] = useState<string | null>(null);

  // Thermal Printer Hardware Sync State (Owner & Manager)
  const [printerConnectionType, setPrinterConnectionType] =
    useState<ThermalPrinterConnectionType>(settings.printerConnectionType ?? 'browser');
  const [printerDeviceName, setPrinterDeviceName] = useState(settings.printerDeviceName ?? '');
  const [printerNetworkIp, setPrinterNetworkIp] = useState(
    settings.printerNetworkIp ?? '192.168.1.100'
  );
  const [printerNetworkPort, setPrinterNetworkPort] = useState(
    String(settings.printerNetworkPort ?? 9100)
  );
  const [printerNetworkBridgeUrl, setPrinterNetworkBridgeUrl] = useState(
    settings.printerNetworkBridgeUrl ?? 'http://localhost:8765/print'
  );
  const [printerBaudRate, setPrinterBaudRate] = useState(String(settings.printerBaudRate ?? 9600));
  const [printerAutoCut, setPrinterAutoCut] = useState(Boolean(settings.printerAutoCut));
  const [printerOpenCashDrawer, setPrinterOpenCashDrawer] = useState(
    Boolean(settings.printerOpenCashDrawer)
  );
  const [printerAutoPrintAfterPayment, setPrinterAutoPrintAfterPayment] = useState(
    Boolean(settings.printerAutoPrintAfterPayment)
  );
  const [printerCopies, setPrinterCopies] = useState(String(settings.printerCopies ?? 1));
  const [printerStatusMsg, setPrinterStatusMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [hwStatusTick, setHwStatusTick] = useState(0);
  const [testingPrint, setTestingPrint] = useState(false);

  // Schedule form (Owner-only)
  const [schTitle, setSchTitle] = useState('');
  const [schFreq, setSchFreq] = useState<OpnameFrequency>('daily');
  const [schTime, setSchTime] = useState('22:00');
  const [schDayOfWeek, setSchDayOfWeek] = useState<number>(0);
  const [schDayOfMonth, setSchDayOfMonth] = useState<string>('1');
  const [schCategory, setSchCategory] = useState<ItemCategoryType | 'all'>('raw_material');
  const [schError, setSchError] = useState<string | null>(null);

  // WhatsApp form (Owner-only)
  const [waProvider, setWaProvider] = useState<'fonnte' | 'wablas'>(
    settings.whatsappGatewayProvider ?? 'fonnte'
  );
  const [waUrl, setWaUrl] = useState(settings.whatsappGatewayUrl ?? 'https://api.fonnte.com/send');
  const [waOwner, setWaOwner] = useState(settings.whatsappOwnerPhone ?? '');
  const [waManager, setWaManager] = useState(settings.whatsappManagerPhone ?? '');
  const [sendingTestWa, setSendingTestWa] = useState(false);

  const [savedToast, setSavedToast] = useState<string | null>(null);

  // RBAC: Manager can access 'store' and 'printer'; only Owner can access 'schedule' and 'whatsapp'
  const effectiveTab =
    !canSeeOpnameScheduleSettings && (activeTab === 'schedule' || activeTab === 'whatsapp')
      ? 'store'
      : activeTab;

  const parsedTaxPercent = Math.max(0, Math.min(100, Number(taxPercent) || 0));
  const parsedPort = Math.max(1, Math.min(65535, Number(printerNetworkPort) || 9100));
  const parsedBaud = Number(printerBaudRate) || 9600;
  const parsedCopies = Math.max(1, Math.min(3, Number(printerCopies) || 1));

  // Read live hardware pairing state (re-read when hwStatusTick changes)
  void hwStatusTick;
  const hwStatus = getActiveHardwareStatus();
  const dueScheduleIdSet = new Set(dueOpnameSchedules.map((s) => s.id));

  const draftPreviewSettings: StoreSettings = {
    ...settings,
    shopName: shopName.trim() || 'BrewFlow Coffee & Roastery',
    address: address.trim() || '-',
    phone: phone.trim(),
    customerServiceContact: customerServiceContact.trim(),
    shopLogoUrl,
    taxEnabled,
    taxPercent: parsedTaxPercent,
    taxLabel: taxLabel.trim() || 'Pajak',
    receiptPaperWidth,
    receiptHeaderText,
    receiptFooterText,
    receiptShowLogo,
    receiptShowCashierAndTable,
    receiptShowMemberInfo,
    receiptShowCustomerService,
    printerConnectionType,
    printerDeviceName,
    printerNetworkIp,
    printerNetworkPort: parsedPort,
    printerNetworkBridgeUrl,
    printerBaudRate: parsedBaud,
    printerAutoCut,
    printerOpenCashDrawer,
    printerAutoPrintAfterPayment,
    printerCopies: parsedCopies,
  };

  const sampleSubtotal = 88000;
  const sampleDiscount = 4400;
  const sampleTaxable = sampleSubtotal - sampleDiscount;
  const sampleTax = taxEnabled ? Math.round(sampleTaxable * (parsedTaxPercent / 100)) : 0;
  const sampleTotal = sampleTaxable + sampleTax;

  const samplePreviewOrder: OrderRecord = {
    id: 'preview-ord',
    order_number: 'BF-261125-099',
    cashier_id: 'preview-cashier',
    cashier_name: 'Nadia Putri',
    customer_id: 'preview-cust',
    customer_name: 'Raka Pratama',
    order_type: 'dine_in',
    table_number: 'Meja 04',
    subtotal: sampleSubtotal,
    discount_amount: sampleDiscount,
    tax_amount: sampleTax,
    total_amount: sampleTotal,
    payment_method: 'cash',
    status: 'completed',
    notes: 'Less ice, extra shot untuk latte',
    items: [
      {
        id: 'prev-1',
        menu_id: 'menu-1',
        menu_name: 'Es Kopi Susu Gula Aren',
        quantity: 2,
        unit_price: 28000,
        subtotal: 56000,
        notes: 'Less sugar',
      },
      {
        id: 'prev-2',
        menu_id: 'menu-6',
        menu_name: 'Butter Croissant',
        quantity: 1,
        unit_price: 32000,
        subtotal: 32000,
      },
    ],
    created_at: new Date().toISOString(),
  };

  const notifySaved = (text: string) => {
    setSavedToast(text);
    window.setTimeout(() => setSavedToast(null), 5000);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('Logo harus berupa file gambar (PNG, JPG, SVG, WEBP).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Ukuran file logo maksimal 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setShopLogoUrl(reader.result);
        setLogoError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveStoreAndReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(
      {
        shopName: shopName.trim() || settings.shopName,
        address: address.trim(),
        phone: phone.trim(),
        customerServiceContact: customerServiceContact.trim(),
        shopLogoUrl,
        taxEnabled,
        taxPercent: parsedTaxPercent,
        taxLabel: taxLabel.trim() || 'Pajak',
        receiptPaperWidth,
        receiptHeaderText,
        receiptFooterText,
        receiptShowLogo,
        receiptShowCashierAndTable,
        receiptShowMemberInfo,
        receiptShowCustomerService,
      },
      liveSupabaseEnabled
    );
    notifySaved(
      `Pengaturan toko, ${taxEnabled ? `pajak (${parsedTaxPercent}%)` : 'pajak nonaktif'}, logo, dan format struk berhasil disimpan.`
    );
  };

  const handleSavePrinterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(
      {
        receiptPaperWidth,
        printerConnectionType,
        printerDeviceName: printerDeviceName.trim(),
        printerNetworkIp: printerNetworkIp.trim() || '192.168.1.100',
        printerNetworkPort: parsedPort,
        printerNetworkBridgeUrl: printerNetworkBridgeUrl.trim(),
        printerBaudRate: parsedBaud,
        printerAutoCut,
        printerOpenCashDrawer,
        printerAutoPrintAfterPayment,
        printerCopies: parsedCopies,
      },
      liveSupabaseEnabled
    );
    notifySaved('Konfigurasi koneksi printer thermal & sinkronisasi ESC/POS berhasil disimpan.');
  };

  const handleConnectBluetooth = async () => {
    const res = await connectBluetoothThermalPrinter();
    if (res.ok && res.deviceName) {
      setPrinterDeviceName(res.deviceName);
    }
    setPrinterStatusMsg({ ok: res.ok, text: res.message });
    setHwStatusTick((t) => t + 1);
  };

  const handleDisconnectBluetooth = () => {
    disconnectBluetoothThermalPrinter();
    setPrinterStatusMsg({ ok: true, text: 'Koneksi Bluetooth printer thermal diputus.' });
    setHwStatusTick((t) => t + 1);
  };

  const handleConnectSerial = async () => {
    const res = await connectSerialThermalPrinter(parsedBaud);
    if (res.ok && res.deviceName) {
      setPrinterDeviceName(res.deviceName);
    }
    setPrinterStatusMsg({ ok: res.ok, text: res.message });
    setHwStatusTick((t) => t + 1);
  };

  const handleTestThermalPrint = async () => {
    setTestingPrint(true);
    const res = await printOrderReceipt(draftPreviewSettings, samplePreviewOrder, {
      cashReceived: 100000,
      cashChange: Math.max(0, 100000 - sampleTotal),
      pointsEarned: Math.floor(sampleTotal / 10000),
    });
    setTestingPrint(false);
    setPrinterStatusMsg({ ok: res.ok, text: res.message });
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSeeOpnameScheduleSettings) return;
    if (!schTitle.trim()) {
      setSchError('Nama jadwal stock opname wajib diisi.');
      return;
    }
    const parsedDayOfMonth = Math.max(1, Math.min(31, Number(schDayOfMonth) || 1));
    await addOpnameSchedule({
      title: schTitle,
      frequency: schFreq,
      execution_time: schTime,
      day_of_week: schFreq === 'weekly' ? schDayOfWeek : undefined,
      day_of_month: schFreq === 'monthly' ? parsedDayOfMonth : undefined,
      target_category: schCategory,
      enableSupabaseSync: liveSupabaseEnabled,
    });
    setSchTitle('');
    setSchError(null);
    notifySaved('Jadwal Stock Opname otomatis baru berhasil ditambahkan.');
  };

  const handleProviderSwitch = (nextProvider: 'fonnte' | 'wablas') => {
    setWaProvider(nextProvider);
    if (
      nextProvider === 'fonnte' &&
      (!waUrl || waUrl.includes('wablas.com'))
    ) {
      setWaUrl('https://api.fonnte.com/send');
    } else if (
      nextProvider === 'wablas' &&
      (!waUrl || waUrl.includes('fonnte.com'))
    ) {
      setWaUrl('https://solo.wablas.com/api/send-message');
    }
  };

  const handleSaveWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSeeOpnameScheduleSettings) return;
    await updateSettings(
      {
        whatsappGatewayProvider: waProvider,
        whatsappGatewayUrl: waUrl.trim(),
        whatsappOwnerPhone: waOwner.trim(),
        whatsappManagerPhone: waManager.trim(),
      },
      liveSupabaseEnabled
    );
    notifySaved('Konfigurasi WhatsApp Gateway & penerima notifikasi berhasil disimpan.');
  };

  const handleSendTestWhatsApp = async () => {
    if (!canSeeOpnameScheduleSettings || sendingTestWa) return;
    setSendingTestWa(true);
    const target = waOwner.trim() || settings.whatsappOwnerPhone;
    const log = await sendWhatsAppMessage({
      eventType: 'test_message',
      targets: target ? [target] : [],
      enableSupabaseSync: liveSupabaseEnabled,
    });
    setSendingTestWa(false);
    if (log.status === 'sent') {
      notifySaved(
        `Pesan uji coba WhatsApp terkirim ke ${target} (${
          log.mode === 'edge_function' ? 'Supabase Edge Function' : 'Simulasi Demo'
        }).`
      );
    } else {
      notifySaved(`Gagal mengirim pesan uji coba: ${log.error ?? 'Periksa nomor tujuan.'}`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Pengaturan Sistem</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            {canSeeOpnameScheduleSettings
              ? 'Atur profil & logo toko, pajak kasir, sinkronisasi printer thermal, jadwal opname, dan WhatsApp.'
              : 'Atur profil & logo toko, pajak kasir, format struk, dan koneksi printer thermal.'}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Tab Pengaturan"
          className="inline-flex flex-wrap rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'store'}
            onClick={() => setActiveTab('store')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              effectiveTab === 'store'
                ? 'bg-[#E6F5EE] text-[#109A58]'
                : 'text-[#6B7280] hover:text-[#1A2E26]'
            }`}
          >
            <Store className="h-3.5 w-3.5" />
            <span>Toko, Pajak &amp; Struk</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'printer'}
            onClick={() => setActiveTab('printer')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              effectiveTab === 'printer'
                ? 'bg-[#E6F5EE] text-[#109A58]'
                : 'text-[#6B7280] hover:text-[#1A2E26]'
            }`}
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Printer Thermal</span>
          </button>

          {canSeeOpnameScheduleSettings && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'schedule'}
                onClick={() => setActiveTab('schedule')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'schedule'
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Pengaturan Jadwal</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'whatsapp'}
                onClick={() => setActiveTab('whatsapp')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'whatsapp'
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>WhatsApp Gateway</span>
              </button>
            </>
          )}
        </div>
      </div>

      {savedToast && (
        <div
          role="status"
          data-testid="settings-toast"
          className="flex items-center gap-2 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{savedToast}</span>
        </div>
      )}

      {/* TAB 1: Store Profile, Logo, Tax Config & Custom Thermal Receipt Print */}
      {effectiveTab === 'store' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form onSubmit={handleSaveStoreAndReceipt} className="space-y-5 lg:col-span-7">
            {/* Section A: Coffee Shop Identity & Logo Upload */}
            <section className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Identitas &amp; Logo Coffee Shop
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Logo dan identitas toko akan tampil di sidebar aplikasi serta tercetak di bagian
                  atas struk pelanggan.
                </p>
              </div>

              {/* Logo Uploader */}
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
                  {shopLogoUrl ? (
                    <img
                      src={shopLogoUrl}
                      alt={`Logo ${shopName}`}
                      className="h-full w-full object-contain p-1.5"
                    />
                  ) : (
                    <Coffee className="h-7 w-7 text-[#109A58]" strokeWidth={2} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs font-semibold text-[#1A2E26]">Logo Coffee Shop</p>
                  <p className="text-[11px] text-[#6B7280]">
                    Format PNG/JPG/SVG (latar transparan disarankan), maksimal 2 MB.
                  </p>
                  {logoError && <p className="text-[11px] font-medium text-[#EF4444]">{logoError}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      aria-label="Unggah logo coffee shop"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EE] px-3.5 py-1.5 text-xs font-semibold text-[#109A58] hover:bg-[#D5EFE2]"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      <span>{shopLogoUrl ? 'Ganti Logo' : 'Upload Logo'}</span>
                    </button>
                    {shopLogoUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setShopLogoUrl(null);
                          if (logoInputRef.current) logoInputRef.current.value = '';
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#EF4444]"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Hapus Logo</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="shop-name" className="block text-xs font-semibold text-[#1A2E26]">
                    Nama Store / Coffee Shop
                  </label>
                  <input
                    id="shop-name"
                    type="text"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="shop-phone" className="block text-xs font-semibold text-[#1A2E26]">
                    Nomor Telepon Toko
                  </label>
                  <input
                    id="shop-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="shop-address" className="block text-xs font-semibold text-[#1A2E26]">
                  Alamat Store (Tercetak di Struk)
                </label>
                <input
                  id="shop-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="shop-cs" className="block text-xs font-semibold text-[#1A2E26]">
                  Contact Customer Service (WA / Email / Instagram)
                </label>
                <input
                  id="shop-cs"
                  type="text"
                  value={customerServiceContact}
                  onChange={(e) => setCustomerServiceContact(e.target.value)}
                  placeholder="Misal: WA 0812-8800-1101 · cs@brewflow.id"
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>
            </section>

            {/* Section B: Tax Settings Toggle */}
            <section className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58]">
                    <Percent className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-[#1A2E26]">
                      Pengaturan Pengenaan Pajak
                    </h2>
                    <p className="mt-0.5 text-xs text-[#6B7280]">
                      Aktifkan atau nonaktifkan perhitungan pajak secara otomatis pada layar Kasir /
                      POS dan struk pembayaran.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={taxEnabled}
                  aria-label="Aktifkan pengenaan pajak"
                  onClick={() => setTaxEnabled((prev) => !prev)}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58] ${
                    taxEnabled ? 'bg-[#109A58]' : 'bg-[#D1D5DB]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                      taxEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-[#F4F6F5] px-3.5 py-2.5 text-xs">
                <span className="font-medium text-[#6B7280]">Status Pajak POS Saat Ini</span>
                <span
                  data-testid="settings-tax-status"
                  className={`font-semibold ${taxEnabled ? 'text-[#109A58]' : 'text-[#6B7280]'}`}
                >
                  {taxEnabled ? `Aktif (${parsedTaxPercent}%)` : 'Nonaktif (0%)'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tax-percent" className="block text-xs font-semibold text-[#1A2E26]">
                    Persentase Pajak (%)
                  </label>
                  <input
                    id="tax-percent"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    disabled={!taxEnabled}
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none disabled:bg-[#F4F6F5] disabled:text-[#9CA3AF]"
                  />
                </div>
                <div>
                  <label htmlFor="tax-label" className="block text-xs font-semibold text-[#1A2E26]">
                    Label Pajak di Struk
                  </label>
                  <input
                    id="tax-label"
                    type="text"
                    disabled={!taxEnabled}
                    value={taxLabel}
                    onChange={(e) => setTaxLabel(e.target.value)}
                    placeholder="PB1 / Pajak Restoran / PPN"
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none disabled:bg-[#F4F6F5] disabled:text-[#9CA3AF]"
                  />
                </div>
              </div>
            </section>

            {/* Section C: Receipt Customization */}
            <section className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Kustomisasi Print Struk Thermal
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Sesuaikan ukuran kertas thermal, teks header/footer, dan elemen informasi yang
                  ingin dicetak di struk kasir.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="paper-width" className="block text-xs font-semibold text-[#1A2E26]">
                    Ukuran Kertas Printer Thermal
                  </label>
                  <select
                    id="paper-width"
                    value={receiptPaperWidth}
                    onChange={(e) => setReceiptPaperWidth(e.target.value as '58mm' | '80mm')}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  >
                    <option value="58mm">Thermal 58 mm (Standar Mini POS)</option>
                    <option value="80mm">Thermal 80 mm (Standar Kasir Besar)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="receipt-header"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Tagline / Header Tambahan
                  </label>
                  <input
                    id="receipt-header"
                    type="text"
                    value={receiptHeaderText}
                    onChange={(e) => setReceiptHeaderText(e.target.value)}
                    placeholder="Misal: Freshly Roasted Specialty Coffee"
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="receipt-footer" className="block text-xs font-semibold text-[#1A2E26]">
                  Pesan Footer / Ucapan Terima Kasih
                </label>
                <textarea
                  id="receipt-footer"
                  rows={2}
                  value={receiptFooterText}
                  onChange={(e) => setReceiptFooterText(e.target.value)}
                  placeholder="Terima kasih telah berkunjung! WiFi: BrewFlow_Guest"
                  className="mt-1.5 w-full rounded-xl border border-[#E5E7EB] p-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-2.5 border-t border-[#E5E7EB] pt-4 text-xs text-[#1A2E26] sm:grid-cols-2">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={receiptShowLogo}
                    onChange={(e) => setReceiptShowLogo(e.target.checked)}
                    className="h-4 w-4 accent-[#109A58]"
                  />
                  <span>Tampilkan Logo Coffee Shop</span>
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={receiptShowCashierAndTable}
                    onChange={(e) => setReceiptShowCashierAndTable(e.target.checked)}
                    className="h-4 w-4 accent-[#109A58]"
                  />
                  <span>Tampilkan Kasir &amp; Nomor Meja</span>
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={receiptShowMemberInfo}
                    onChange={(e) => setReceiptShowMemberInfo(e.target.checked)}
                    className="h-4 w-4 accent-[#109A58]"
                  />
                  <span>Tampilkan Info Member &amp; Poin</span>
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={receiptShowCustomerService}
                    onChange={(e) => setReceiptShowCustomerService(e.target.checked)}
                    className="h-4 w-4 accent-[#109A58]"
                  />
                  <span>Tampilkan Kontak Customer Service</span>
                </label>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E]"
                >
                  Simpan Pengaturan Toko &amp; Struk
                </button>
              </div>
            </section>
          </form>

          {/* Right Column: Live Thermal Receipt Preview & Test Print */}
          <div className="lg:col-span-5">
            <div className="sticky top-6 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#1A2E26]">Live Preview Struk</h2>
                  <p className="text-[11px] text-[#6B7280]">
                    Kertas {receiptPaperWidth} · Daftar barang &amp; info toko otomatis tersinkron
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTestThermalPrint()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#E6F5EE] px-4 text-xs font-semibold text-[#109A58] transition-colors hover:bg-[#D5EFE2] whitespace-nowrap"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Test Print Struk</span>
                </button>
              </div>

              <div className="rounded-2xl bg-[#F4F6F5] p-4">
                <PrintableReceipt
                  settings={draftPreviewSettings}
                  order={samplePreviewOrder}
                  cashReceived={100000}
                  cashChange={Math.max(0, 100000 - sampleTotal)}
                  pointsEarned={Math.floor(sampleTotal / 10000)}
                  isPrintTarget
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Thermal Printer Hardware Integration (Bluetooth, WiFi/LAN, USB Serial, Driver OS) */}
      {effectiveTab === 'printer' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form onSubmit={handleSavePrinterSettings} className="space-y-5 lg:col-span-7">
            <section className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Sinkronisasi Mesin Printer Thermal (ESC/POS)
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Hubungkan printer thermal 58mm/80mm (Epson, Xprinter, Panda, Blueprint, Rongta,
                  Eppos) menggunakan Bluetooth, jaringan WiFi/LAN, USB Serial, atau driver OS.
                </p>
              </div>

              {/* Connection Mode Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  {
                    id: 'bluetooth' as const,
                    title: 'Bluetooth (BLE)',
                    desc: 'Pairing langsung tanpa kabel ke printer thermal Bluetooth.',
                    icon: Bluetooth,
                  },
                  {
                    id: 'network' as const,
                    title: 'Jaringan WiFi / LAN',
                    desc: 'Cetak via IP Address & Port 9100 (Print Bridge / LAN).',
                    icon: Wifi,
                  },
                  {
                    id: 'usb_serial' as const,
                    title: 'USB / Serial (ESC/POS)',
                    desc: 'Koneksi kabel USB langsung via Web Serial API.',
                    icon: Usb,
                  },
                  {
                    id: 'browser' as const,
                    title: 'Browser / Driver OS',
                    desc: 'Gunakan driver printer Windows, macOS, atau Android.',
                    icon: Monitor,
                  },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = printerConnectionType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`printer-mode-${opt.id}`}
                      onClick={() => {
                        setPrinterConnectionType(opt.id);
                        setPrinterStatusMsg(null);
                      }}
                      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-[#109A58] bg-[#E6F5EE]/60'
                          : 'border-[#E5E7EB] bg-[#FFFFFF] hover:border-[#109A58]/40'
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          active
                            ? 'bg-[#109A58] text-white'
                            : 'bg-[#F4F6F5] text-[#6B7280]'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#1A2E26]">{opt.title}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-[#6B7280]">
                          {opt.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Iframe Permissions-Policy Warning for Web Bluetooth & Web Serial */}
              {isRunningInIframe() &&
                (printerConnectionType === 'bluetooth' ||
                  printerConnectionType === 'usb_serial') && (
                  <div
                    data-testid="printer-iframe-notice"
                    className="rounded-2xl border border-[#F59E0B]/40 bg-[#FFFBEB] p-4 text-xs text-[#92400E]"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />
                      <div className="space-y-1.5">
                        <p className="font-semibold text-[#78350F]">
                          Catatan Keamanan Browser (Mode Preview / Iframe)
                        </p>
                        <p className="leading-relaxed">
                          Chrome &amp; Edge memblokir akses langsung{' '}
                          <strong>Web Bluetooth / Web Serial</strong> di dalam frame preview
                          (muncul error <em>&ldquo;Failed to execute requestDevice/requestPort&rdquo;</em>
                          ). Untuk pairing Bluetooth/USB langsung, buka URL aplikasi ini di{' '}
                          <strong>tab browser penuh (HTTPS)</strong>, atau gunakan mode alternatif
                          di bawah:
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setPrinterConnectionType('browser')}
                            className="rounded-full bg-[#109A58] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#0D8A4E]"
                          >
                            Beralih ke Driver OS / Browser
                          </button>
                          <button
                            type="button"
                            onClick={() => setPrinterConnectionType('network')}
                            className="rounded-full border border-[#D97706]/40 bg-white px-3 py-1 text-[11px] font-semibold text-[#92400E] hover:bg-[#FEF3C7]"
                          >
                            Gunakan WiFi / LAN (Port 9100)
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              {/* Channel-Specific Configuration */}
              {printerConnectionType === 'bluetooth' && (
                <div className="space-y-3 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-[#1A2E26]">
                        Pairing Printer Thermal Bluetooth (GATT BLE)
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        {isWebBluetoothSupported()
                          ? 'Browser mendukung Web Bluetooth. Pastikan Bluetooth printer menyala.'
                          : 'Browser saat ini tidak mengekspos Web Bluetooth. Gunakan Chrome/Edge desktop atau Android.'}
                      </p>
                    </div>
                    <span
                      data-testid="printer-bt-status"
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        hwStatus.bluetoothConnected
                          ? 'bg-[#E6F5EE] text-[#109A58]'
                          : 'bg-white text-[#6B7280]'
                      }`}
                    >
                      {hwStatus.bluetoothConnected
                        ? `Terhubung: ${hwStatus.bluetoothName || 'Printer BLE'}`
                        : 'Belum Terhubung'}
                    </span>
                  </div>

                  <div>
                    <label
                      htmlFor="printer-device-name"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      Nama Perangkat Printer Tersimpan
                    </label>
                    <input
                      id="printer-device-name"
                      type="text"
                      value={printerDeviceName}
                      onChange={(e) => setPrinterDeviceName(e.target.value)}
                      placeholder="Misal: RPP02N / Xprinter-58BT / BlueTooth Printer"
                      className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleConnectBluetooth()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
                    >
                      <Bluetooth className="h-3.5 w-3.5" />
                      <span>Cari &amp; Hubungkan Bluetooth</span>
                    </button>
                    {hwStatus.bluetoothConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectBluetooth}
                        className="inline-flex h-9 items-center rounded-full border border-[#E5E7EB] bg-white px-4 text-xs font-semibold text-[#6B7280] hover:text-[#EF4444]"
                      >
                        Putuskan Koneksi
                      </button>
                    )}
                  </div>
                </div>
              )}

              {printerConnectionType === 'network' && (
                <div className="space-y-3 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4">
                  <p className="text-xs font-semibold text-[#1A2E26]">
                    Konfigurasi Jaringan WiFi / LAN (TCP/IP Port 9100)
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="printer-ip"
                        className="block text-xs font-medium text-[#6B7280]"
                      >
                        IP Address Printer Thermal
                      </label>
                      <input
                        id="printer-ip"
                        type="text"
                        value={printerNetworkIp}
                        onChange={(e) => setPrinterNetworkIp(e.target.value)}
                        placeholder="192.168.1.100"
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="printer-port"
                        className="block text-xs font-medium text-[#6B7280]"
                      >
                        Port TCP
                      </label>
                      <input
                        id="printer-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={printerNetworkPort}
                        onChange={(e) => setPrinterNetworkPort(e.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 font-mono text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="printer-bridge"
                      className="block text-xs font-medium text-[#6B7280]"
                    >
                      Endpoint Local Print Bridge / Gateway HTTP (untuk mengirim payload ESC/POS ke
                      LAN)
                    </label>
                    <input
                      id="printer-bridge"
                      type="url"
                      value={printerNetworkBridgeUrl}
                      onChange={(e) => setPrinterNetworkBridgeUrl(e.target.value)}
                      placeholder="http://localhost:8765/print"
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {printerConnectionType === 'usb_serial' && (
                <div className="space-y-3 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-[#1A2E26]">
                        Koneksi Kabel USB / Serial ESC/POS
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        {isWebSerialSupported()
                          ? 'Web Serial API siap digunakan untuk printer kasir USB.'
                          : 'Browser belum mendukung Web Serial API. Gunakan Chrome/Edge desktop.'}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[#6B7280]">
                      {hwStatus.serialConnected ? 'Port Terhubung' : 'Belum Terhubung'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-44">
                      <label
                        htmlFor="printer-baud"
                        className="block text-xs font-medium text-[#6B7280]"
                      >
                        Baud Rate
                      </label>
                      <select
                        id="printer-baud"
                        value={printerBaudRate}
                        onChange={(e) => setPrinterBaudRate(e.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      >
                        <option value="9600">9600 bps (Standar)</option>
                        <option value="19200">19200 bps</option>
                        <option value="38400">38400 bps</option>
                        <option value="115200">115200 bps (Cepat)</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleConnectSerial()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
                    >
                      <Usb className="h-3.5 w-3.5" />
                      <span>Pilih Port USB / Serial</span>
                    </button>
                  </div>
                </div>
              )}

              {printerConnectionType === 'browser' && (
                <div className="rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4 text-xs text-[#6B7280]">
                  Mode <strong className="text-[#1A2E26]">Browser / Driver OS</strong> kompatibel
                  dengan seluruh mesin printer thermal yang sudah terpasang di sistem operasi
                  (Windows, macOS, Android, iPadOS) melalui layout cetak thermal otomatis.
                </div>
              )}

              {/* Hardware Behavior & Paper Controls */}
              <div className="space-y-4 border-t border-[#E5E7EB] pt-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="printer-paper-width"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      Lebar Kertas Thermal
                    </label>
                    <select
                      id="printer-paper-width"
                      value={receiptPaperWidth}
                      onChange={(e) => setReceiptPaperWidth(e.target.value as '58mm' | '80mm')}
                      className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    >
                      <option value="58mm">58 mm (32 karakter / baris)</option>
                      <option value="80mm">80 mm (48 karakter / baris)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="printer-copies"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      Jumlah Salinan Cetak
                    </label>
                    <select
                      id="printer-copies"
                      value={printerCopies}
                      onChange={(e) => setPrinterCopies(e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                    >
                      <option value="1">1 Salinan (Pelanggan)</option>
                      <option value="2">2 Salinan (Pelanggan + Barista/Dapur)</option>
                      <option value="3">3 Salinan</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2.5 text-xs text-[#1A2E26]">
                  <label className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={printerAutoCut}
                      onChange={(e) => setPrinterAutoCut(e.target.checked)}
                      className="h-4 w-4 accent-[#109A58]"
                    />
                    <span>Aktifkan Auto-Cut Kertas otomatis (ESC/POS GS V)</span>
                  </label>
                  <label className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={printerOpenCashDrawer}
                      onChange={(e) => setPrinterOpenCashDrawer(e.target.checked)}
                      className="h-4 w-4 accent-[#109A58]"
                    />
                    <span>Buka Laci Kasir otomatis (Cash Drawer RJ11 Kick Pulse)</span>
                  </label>
                  <label className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={printerAutoPrintAfterPayment}
                      onChange={(e) => setPrinterAutoPrintAfterPayment(e.target.checked)}
                      className="h-4 w-4 accent-[#109A58]"
                    />
                    <span>Cetak struk otomatis langsung setelah pembayaran POS dikonfirmasi</span>
                  </label>
                </div>
              </div>

              {printerStatusMsg && (
                <div
                  role="status"
                  data-testid="printer-status-message"
                  className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                    printerStatusMsg.ok
                      ? 'border-[#109A58]/30 bg-[#E6F5EE] text-[#109A58]'
                      : 'border-[#F59E0B]/40 bg-[#FFFBEB] text-[#B45309]'
                  }`}
                >
                  {printerStatusMsg.text}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={testingPrint}
                  onClick={() => void handleTestThermalPrint()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#E6F5EE] px-5 text-xs font-semibold text-[#109A58] transition-colors hover:bg-[#D5EFE2] disabled:opacity-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{testingPrint ? 'Mengirim...' : 'Test Cetak ESC/POS'}</span>
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E]"
                >
                  Simpan Pengaturan Printer
                </button>
              </div>
            </section>
          </form>

          {/* Right Column: Active Printer Summary & Receipt Preview */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[#1A2E26]">Ringkasan Koneksi Aktif</h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-[#6B7280]">Jalur Koneksi</dt>
                  <dd className="font-semibold text-[#1A2E26]">
                    {printerConnectionType === 'bluetooth'
                      ? 'Bluetooth (BLE ESC/POS)'
                      : printerConnectionType === 'network'
                        ? `WiFi / LAN (${printerNetworkIp}:${parsedPort})`
                        : printerConnectionType === 'usb_serial'
                          ? `USB / Serial (${parsedBaud} bps)`
                          : 'Browser / Driver OS'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#6B7280]">Ukuran Kertas</dt>
                  <dd className="font-semibold text-[#1A2E26]">{receiptPaperWidth}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#6B7280]">Auto-Cut / Cash Drawer</dt>
                  <dd className="font-semibold text-[#1A2E26]">
                    {printerAutoCut ? 'Auto-Cut' : 'Manual'} ·{' '}
                    {printerOpenCashDrawer ? 'Kick Drawer' : 'Nonaktif'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#6B7280]">Salinan / Auto-Print</dt>
                  <dd className="font-semibold text-[#1A2E26]">
                    {parsedCopies}x · {printerAutoPrintAfterPayment ? 'Auto-Print Aktif' : 'Manual'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[#1A2E26]">
                Preview Output Kertas {receiptPaperWidth}
              </h3>
              <div className="rounded-2xl bg-[#F4F6F5] p-4">
                <PrintableReceipt
                  settings={draftPreviewSettings}
                  order={samplePreviewOrder}
                  cashReceived={100000}
                  cashChange={Math.max(0, 100000 - sampleTotal)}
                  pointsEarned={Math.floor(sampleTotal / 10000)}
                  isPrintTarget
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Owner-Only Stock Opname Schedule Settings */}
      {effectiveTab === 'schedule' && canSeeOpnameScheduleSettings && (
        <div className="space-y-5">
          <form
            onSubmit={handleCreateSchedule}
            className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Tambah Jadwal Stock Opname Otomatis
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Sistem NotificationWatcher akan otomatis memunculkan banner &amp; mengirim
                  pengingat WhatsApp saat jadwal jatuh tempo.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#109A58]">
                <Lock className="h-3.5 w-3.5" />
                Khusus Owner
              </span>
            </div>
            {schError && <p className="mt-2 text-xs font-medium text-[#EF4444]">{schError}</p>}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <label htmlFor="sch-title" className="block text-xs font-medium text-[#6B7280]">
                  Nama Jadwal
                </label>
                <input
                  id="sch-title"
                  type="text"
                  value={schTitle}
                  onChange={(e) => setSchTitle(e.target.value)}
                  placeholder="Misal: Opname Harian Bahan Bar"
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="sch-freq" className="block text-xs font-medium text-[#6B7280]">
                  Frekuensi
                </label>
                <select
                  id="sch-freq"
                  value={schFreq}
                  onChange={(e) => setSchFreq(e.target.value as OpnameFrequency)}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                >
                  <option value="daily">Harian (Daily)</option>
                  <option value="weekly">Mingguan (Weekly)</option>
                  <option value="monthly">Bulanan (Monthly)</option>
                </select>
              </div>

              <div>
                <label htmlFor="sch-time" className="block text-xs font-medium text-[#6B7280]">
                  Jam Eksekusi (WIB)
                </label>
                <input
                  id="sch-time"
                  type="time"
                  value={schTime}
                  onChange={(e) => setSchTime(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="sch-cat" className="block text-xs font-medium text-[#6B7280]">
                  Target Kategori
                </label>
                <select
                  id="sch-cat"
                  value={schCategory}
                  onChange={(e) => setSchCategory(e.target.value as ItemCategoryType | 'all')}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                >
                  <option value="raw_material">Bahan Baku</option>
                  <option value="packaging">Kemasan</option>
                  <option value="asset">Aset Coffee Shop</option>
                  <option value="all">Semua Kategori</option>
                </select>
              </div>

              {schFreq === 'weekly' && (
                <div className="sm:col-span-2">
                  <label
                    htmlFor="sch-day-of-week"
                    className="block text-xs font-medium text-[#6B7280]"
                  >
                    Hari Eksekusi (Khusus Mingguan)
                  </label>
                  <select
                    id="sch-day-of-week"
                    value={schDayOfWeek}
                    onChange={(e) => setSchDayOfWeek(Number(e.target.value))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  >
                    {INDONESIAN_DAYS.map((day) => (
                      <option key={day.value} value={day.value}>
                        Setiap Hari {day.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {schFreq === 'monthly' && (
                <div className="sm:col-span-2">
                  <label
                    htmlFor="sch-day-of-month"
                    className="block text-xs font-medium text-[#6B7280]"
                  >
                    Tanggal Eksekusi (1 – 31, Khusus Bulanan)
                  </label>
                  <input
                    id="sch-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={schDayOfMonth}
                    onChange={(e) => setSchDayOfMonth(e.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                className="h-10 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
              >
                Buat Jadwal Opname
              </button>
            </div>
          </form>

          <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
              <h3 className="text-sm font-semibold text-[#1A2E26]">Daftar Jadwal Terdaftar</h3>
              <span className="text-xs text-[#6B7280] tabular-nums">
                {opnameSchedules.length} jadwal
              </span>
            </div>
            <div className="divide-y divide-[#E5E7EB]">
              {opnameSchedules.map((sch) => {
                const isDue = dueScheduleIdSet.has(sch.id);
                return (
                  <div
                    key={sch.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-[#1A2E26]">{sch.title}</p>
                        {isDue && (
                          <span className="rounded-md bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-bold text-[#EF4444]">
                            Jatuh Tempo Hari Ini
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[#6B7280]">
                        {getFrequencyDescription(sch)} · Target:{' '}
                        <span className="font-medium text-[#1A2E26]">
                          {getCategoryTargetLabel(sch.target_category)}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void toggleOpnameSchedule(sch.id, liveSupabaseEnabled)}
                        className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                          sch.is_active
                            ? 'bg-[#E6F5EE] text-[#109A58]'
                            : 'bg-[#F4F6F5] text-[#6B7280]'
                        }`}
                      >
                        {sch.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Hapus jadwal ${sch.title}`}
                        onClick={() => void deleteOpnameSchedule(sch.id, liveSupabaseEnabled)}
                        className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Owner-Only WhatsApp Gateway Settings & Delivery Logs */}
      {effectiveTab === 'whatsapp' && canSeeOpnameScheduleSettings && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSaveWhatsApp}
            className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 space-y-4 lg:col-span-7"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  Integrasi Notifikasi WhatsApp (Edge Function)
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Token API disimpan aman di Supabase Secrets (<code className="font-mono">WHATSAPP_API_TOKEN</code>), tidak pernah terekspos di browser.
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#109A58]">
                <Lock className="h-3.5 w-3.5" />
                Khusus Owner
              </span>
            </div>

            <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wa-provider" className="block text-xs font-medium text-[#6B7280]">
                  Provider WhatsApp Gateway
                </label>
                <select
                  id="wa-provider"
                  value={waProvider}
                  onChange={(e) => handleProviderSwitch(e.target.value as 'fonnte' | 'wablas')}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                >
                  <option value="fonnte">Fonnte (REST API)</option>
                  <option value="wablas">Wablas (REST API)</option>
                </select>
              </div>

              <div>
                <label htmlFor="wa-url" className="block text-xs font-medium text-[#6B7280]">
                  Endpoint REST API Gateway
                </label>
                <input
                  id="wa-url"
                  type="url"
                  value={waUrl}
                  onChange={(e) => setWaUrl(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="wa-owner" className="block text-xs font-medium text-[#6B7280]">
                  WhatsApp Owner (Laporan Selisih &amp; Alert)
                </label>
                <input
                  id="wa-owner"
                  type="tel"
                  value={waOwner}
                  onChange={(e) => setWaOwner(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="wa-manager" className="block text-xs font-medium text-[#6B7280]">
                  WhatsApp Manager (Pengingat Opname)
                </label>
                <input
                  id="wa-manager"
                  type="tel"
                  value={waManager}
                  onChange={(e) => setWaManager(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2.5 border-t border-[#E5E7EB] pt-4 text-xs text-[#1A2E26]">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={settings.whatsappAutoOpnameReminder}
                  onChange={(e) =>
                    void updateSettings(
                      { whatsappAutoOpnameReminder: e.target.checked },
                      liveSupabaseEnabled
                    )
                  }
                  className="h-4 w-4 accent-[#109A58]"
                />
                <span>Kirim pengingat jadwal Stock Opname otomatis ke Manager &amp; Owner</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={settings.whatsappAutoLowStock}
                  onChange={(e) =>
                    void updateSettings(
                      { whatsappAutoLowStock: e.target.checked },
                      liveSupabaseEnabled
                    )
                  }
                  className="h-4 w-4 accent-[#109A58]"
                />
                <span>Kirim peringatan stok menipis saat bahan di bawah batas minimum</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={settings.whatsappAutoReceipt}
                  onChange={(e) =>
                    void updateSettings(
                      { whatsappAutoReceipt: e.target.checked },
                      liveSupabaseEnabled
                    )
                  }
                  className="h-4 w-4 accent-[#109A58]"
                />
                <span>Kirim struk digital &amp; ringkasan poin member setelah pembayaran POS</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={sendingTestWa}
                onClick={() => void handleSendTestWhatsApp()}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#E6F5EE] px-5 text-xs font-semibold text-[#109A58] hover:bg-[#D5EFE2] disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{sendingTestWa ? 'Mengirim...' : 'Kirim Pesan Test'}</span>
              </button>
              <button
                type="submit"
                className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
              >
                Simpan Konfigurasi WhatsApp
              </button>
            </div>
          </form>

          {/* Right Column: Live WhatsApp Delivery Log & Edge Function Deploy Quick Reference */}
          <div className="space-y-4 lg:col-span-5">
            <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
              <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3.5">
                <h3 className="text-sm font-semibold text-[#1A2E26]">Log Pengiriman WhatsApp</h3>
                <span className="text-xs text-[#6B7280] tabular-nums">
                  {whatsappLogs.length} pesan
                </span>
              </div>
              <div className="max-h-72 divide-y divide-[#E5E7EB] overflow-y-auto">
                {whatsappLogs.length === 0 ? (
                  <p className="p-6 text-center text-xs text-[#6B7280]">
                    Belum ada pengiriman WhatsApp pada sesi ini. Klik &quot;Kirim Pesan Test&quot;
                    atau selesaikan Stock Opname / Transaksi POS.
                  </p>
                ) : (
                  whatsappLogs.map((log) => (
                    <div key={log.id} className="space-y-1 px-5 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#1A2E26]">
                          {EVENT_TYPE_LABELS[log.event_type]}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                            log.status === 'sent'
                              ? 'bg-[#E6F5EE] text-[#109A58]'
                              : 'bg-[#FEF2F2] text-[#EF4444]'
                          }`}
                        >
                          {log.status === 'sent'
                            ? log.mode === 'edge_function'
                              ? 'Terkirim (Live)'
                              : 'Terkirim (Demo)'
                            : 'Gagal'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#4B5563]">{log.preview}</p>
                      <div className="flex items-center justify-between text-[10px] text-[#6B7280] tabular-nums">
                        <span>Tujuan: {log.targets.join(', ') || '-'}</span>
                        <span>{formatDateTime(log.sent_at)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1A2E26]">
                <Terminal className="h-4 w-4 text-[#109A58]" />
                <span>Deploy Edge Function (send-whatsapp)</span>
              </div>
              <p className="text-[11px] text-[#6B7280]">
                File fungsi sudah siap di{' '}
                <code className="font-mono text-[#1A2E26]">
                  supabase/functions/send-whatsapp/index.ts
                </code>
                . Jalankan perintah berikut via Supabase CLI:
              </p>
              <pre className="overflow-x-auto rounded-xl bg-[#1A2E26] p-3 font-mono text-[11px] leading-relaxed text-[#E6F5EE]">
{`supabase secrets set WHATSAPP_GATEWAY_PROVIDER=${waProvider} \\
  WHATSAPP_GATEWAY_URL=${waUrl || 'https://api.fonnte.com/send'} \\
  WHATSAPP_API_TOKEN=TOKEN_GATEWAY_ANDA

supabase functions deploy send-whatsapp`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
