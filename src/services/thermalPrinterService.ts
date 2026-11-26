import type { OrderRecord, StoreSettings } from '../types';
import { formatDateTime, formatRupiah } from '../utils/format';

// Common BLE GATT Service UUIDs used across Bluetooth thermal receipt printers
// (Epson, Star, Xprinter, Panda, Blueprint, Eppos, Rongta, ZJiang)
const BLE_PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

const BLE_PRINTER_WRITE_CHAR_UUIDS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
];

interface BluetoothCharacteristicLike {
  writeValue: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
  properties?: { write?: boolean; writeWithoutResponse?: boolean };
}

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<{
      getPrimaryServices: () => Promise<
        Array<{
          uuid: string;
          getCharacteristics: () => Promise<BluetoothCharacteristicLike[]>;
        }>
      >;
    }>;
    disconnect: () => void;
  };
}

interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable?: WritableStream<Uint8Array>;
}

let activeBluetoothDevice: BluetoothDeviceLike | null = null;
let activeBluetoothChar: BluetoothCharacteristicLike | null = null;
let activeSerialPort: SerialPortLike | null = null;

export interface PrinterActionResult {
  ok: boolean;
  channel: StoreSettings['printerConnectionType'];
  message: string;
  deviceName?: string;
}

export interface ReceiptPrintExtras {
  cashReceived?: number;
  cashChange?: number;
  pointsEarned?: number;
}

function padLine(left: string, right: string, width: number): string {
  const cleanLeft = left.replace(/\s+/g, ' ').trim();
  const cleanRight = right.trim();
  const maxLeft = Math.max(4, width - cleanRight.length - 1);
  const clippedLeft =
    cleanLeft.length > maxLeft ? `${cleanLeft.slice(0, maxLeft - 1)}…` : cleanLeft;
  const spaces = Math.max(1, width - clippedLeft.length - cleanRight.length);
  return `${clippedLeft}${' '.repeat(spaces)}${cleanRight}`;
}

/**
 * Pure function: encodes a BrewFlow POS order & custom store settings into a
 * universal ESC/POS binary command buffer compatible with 58mm & 80mm thermal printers.
 */
export function buildEscPosReceiptBytes(
  settings: StoreSettings,
  order: OrderRecord,
  extras: ReceiptPrintExtras = {}
): Uint8Array {
  const cols = settings.receiptPaperWidth === '80mm' ? 48 : 32;
  const divider = '-'.repeat(cols);
  const encoder = new TextEncoder();
  const chunks: number[] = [];

  const pushBytes = (...bytes: number[]) => {
    for (const b of bytes) chunks.push(b);
  };
  const pushTextLine = (line: string) => {
    const encoded = encoder.encode(`${line}\n`);
    for (const b of encoded) chunks.push(b);
  };

  // ESC @ : Initialize printer
  pushBytes(0x1b, 0x40);

  // Header (Center aligned)
  pushBytes(0x1b, 0x61, 0x01); // ESC a 1 (center)
  pushBytes(0x1b, 0x45, 0x01); // ESC E 1 (bold on)
  pushTextLine(settings.shopName.toUpperCase());
  pushBytes(0x1b, 0x45, 0x00); // bold off
  if (settings.address) pushTextLine(settings.address);
  if (settings.phone) pushTextLine(`Telp: ${settings.phone}`);
  if (settings.receiptHeaderText.trim()) pushTextLine(settings.receiptHeaderText.trim());
  pushTextLine(divider);

  // Order metadata (Left aligned)
  pushBytes(0x1b, 0x61, 0x00); // ESC a 0 (left)
  pushTextLine(padLine('No. Order', order.order_number, cols));
  pushTextLine(padLine('Waktu', formatDateTime(order.created_at), cols));
  if (settings.receiptShowCashierAndTable) {
    pushTextLine(padLine('Kasir', order.cashier_name, cols));
    pushTextLine(padLine('Tipe', order.table_number, cols));
  }
  if (settings.receiptShowMemberInfo && order.customer_name) {
    pushTextLine(padLine('Member', order.customer_name, cols));
  }
  pushTextLine(divider);

  // Itemized list
  for (const item of order.items) {
    pushTextLine(padLine(item.menu_name, formatRupiah(item.subtotal), cols));
    pushTextLine(`  ${item.quantity} x ${formatRupiah(item.unit_price)}`);
    if (item.notes) {
      pushTextLine(`  Catatan: ${item.notes}`);
    }
  }
  if (order.notes) {
    pushTextLine(`Note: ${order.notes}`);
  }
  pushTextLine(divider);

  // Totals
  pushTextLine(padLine('Subtotal', formatRupiah(order.subtotal), cols));
  if (order.discount_amount > 0) {
    pushTextLine(padLine('Diskon Member', `-${formatRupiah(order.discount_amount)}`, cols));
  }
  if (settings.taxEnabled || order.tax_amount > 0) {
    const label = `${settings.taxLabel || 'Pajak'} (${settings.taxEnabled ? settings.taxPercent : 0}%)`;
    pushTextLine(padLine(label, formatRupiah(order.tax_amount), cols));
  } else {
    pushTextLine(padLine('Pajak', 'Nonaktif', cols));
  }
  pushTextLine(divider);

  pushBytes(0x1b, 0x45, 0x01); // bold on
  pushTextLine(padLine('TOTAL', formatRupiah(order.total_amount), cols));
  pushBytes(0x1b, 0x45, 0x00); // bold off

  const payLabel =
    order.payment_method === 'qris'
      ? 'QRIS'
      : order.payment_method === 'debit'
        ? 'Debit'
        : 'Tunai';
  const received =
    order.payment_method === 'cash' && extras.cashReceived !== undefined
      ? extras.cashReceived
      : order.total_amount;
  pushTextLine(padLine(`Bayar (${payLabel})`, formatRupiah(received), cols));

  if (order.payment_method === 'cash' && extras.cashChange && extras.cashChange > 0) {
    pushTextLine(padLine('Kembalian', formatRupiah(extras.cashChange), cols));
  }
  if (settings.receiptShowMemberInfo && extras.pointsEarned && extras.pointsEarned > 0) {
    pushTextLine(padLine('Poin Member', `+${extras.pointsEarned} pts`, cols));
  }
  pushTextLine(divider);

  // Footer (Center aligned)
  pushBytes(0x1b, 0x61, 0x01);
  if (settings.receiptShowCustomerService && settings.customerServiceContact.trim()) {
    pushTextLine(`CS: ${settings.customerServiceContact.trim()}`);
  }
  if (settings.receiptFooterText.trim()) {
    pushTextLine(settings.receiptFooterText.trim());
  }
  pushTextLine('');
  pushTextLine('');

  // Optional Cash Drawer Kick Pulse: ESC p 0 25 250
  if (settings.printerOpenCashDrawer) {
    pushBytes(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }

  // Optional Auto-Cut: GS V 66 3
  if (settings.printerAutoCut) {
    pushBytes(0x1d, 0x56, 0x42, 0x03);
  }

  return new Uint8Array(chunks);
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function formatHardwareConnectionError(
  err: unknown,
  channel: 'bluetooth' | 'usb_serial'
): string {
  const raw = err instanceof Error ? err.message : '';
  const name = err instanceof Error ? err.name : '';
  const channelLabel = channel === 'bluetooth' ? 'Web Bluetooth' : 'Web Serial (USB)';

  if (name === 'NotFoundError') {
    return channel === 'bluetooth'
      ? 'Pencarian perangkat Bluetooth dibatalkan oleh pengguna.'
      : 'Pemilihan port USB/Serial dibatalkan oleh pengguna.';
  }

  if (
    name === 'SecurityError' ||
    /permissions policy|disallowed by permissions policy|failed to execute/i.test(raw)
  ) {
    return `Akses ${channelLabel} diblokir oleh kebijakan keamanan browser (Permissions-Policy) karena aplikasi sedang dibuka di dalam mode Preview / iframe. Solusi: (1) Buka URL aplikasi langsung di tab penuh Chrome/Edge (HTTPS), atau (2) Gunakan mode "Browser / Driver OS" atau "Jaringan WiFi / LAN".`;
  }

  return raw || `Gagal menghubungkan printer melalui ${channelLabel}.`;
}

export function getActiveHardwareStatus(): {
  bluetoothConnected: boolean;
  bluetoothName: string | null;
  serialConnected: boolean;
} {
  return {
    bluetoothConnected: Boolean(activeBluetoothDevice?.gatt?.connected && activeBluetoothChar),
    bluetoothName: activeBluetoothDevice?.name ?? null,
    serialConnected: Boolean(activeSerialPort),
  };
}

/**
 * Initiates Web Bluetooth discovery & GATT pairing for BLE ESC/POS thermal printers.
 */
export async function connectBluetoothThermalPrinter(): Promise<PrinterActionResult> {
  if (!isWebBluetoothSupported()) {
    return {
      ok: false,
      channel: 'bluetooth',
      message:
        'Browser ini belum mendukung Web Bluetooth API. Gunakan Chrome/Edge desktop atau Android untuk pairing langsung Bluetooth thermal printer.',
    };
  }

  try {
    const nav = navigator as Navigator & {
      bluetooth: {
        requestDevice: (opts: Record<string, unknown>) => Promise<BluetoothDeviceLike>;
      };
    };

    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PRINTER_SERVICE_UUIDS,
    });

    if (!device.gatt) {
      return {
        ok: false,
        channel: 'bluetooth',
        message: 'Perangkat tidak mengekspos GATT service untuk printer thermal.',
      };
    }

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let writableChar: BluetoothCharacteristicLike | null = null;

    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties?.writeWithoutResponse || ch.properties?.write) {
          writableChar = ch;
          break;
        }
      }
      if (writableChar) break;
    }

    if (!writableChar) {
      device.gatt.disconnect();
      return {
        ok: false,
        channel: 'bluetooth',
        message: `Perangkat "${device.name || 'Bluetooth'}" terhubung namun tidak memiliki karakteristik cetak ESC/POS (${BLE_PRINTER_WRITE_CHAR_UUIDS[0]}).`,
      };
    }

    activeBluetoothDevice = device;
    activeBluetoothChar = writableChar;

    return {
      ok: true,
      channel: 'bluetooth',
      deviceName: device.name || 'Bluetooth Thermal Printer',
      message: `Printer Bluetooth "${device.name || 'Thermal Printer'}" berhasil terhubung dan siap mencetak.`,
    };
  } catch (err) {
    return {
      ok: false,
      channel: 'bluetooth',
      message: formatHardwareConnectionError(err, 'bluetooth'),
    };
  }
}

export function disconnectBluetoothThermalPrinter(): void {
  if (activeBluetoothDevice?.gatt?.connected) {
    activeBluetoothDevice.gatt.disconnect();
  }
  activeBluetoothDevice = null;
  activeBluetoothChar = null;
}

/**
 * Initiates Web Serial connection for USB/Serial ESC/POS thermal printers.
 */
export async function connectSerialThermalPrinter(baudRate = 9600): Promise<PrinterActionResult> {
  if (!isWebSerialSupported()) {
    return {
      ok: false,
      channel: 'usb_serial',
      message:
        'Web Serial API tidak tersedia di browser ini. Gunakan Chrome/Edge atau mode Driver OS.',
    };
  }

  try {
    const nav = navigator as Navigator & {
      serial: { requestPort: () => Promise<SerialPortLike> };
    };
    const port = await nav.serial.requestPort();
    await port.open({ baudRate });
    activeSerialPort = port;
    return {
      ok: true,
      channel: 'usb_serial',
      deviceName: `USB/Serial (${baudRate} bps)`,
      message: `Printer USB/Serial terhubung pada ${baudRate} bps.`,
    };
  } catch (err) {
    return {
      ok: false,
      channel: 'usb_serial',
      message: formatHardwareConnectionError(err, 'usb_serial'),
    };
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sendBytesOverBluetooth(bytes: Uint8Array): Promise<void> {
  if (!activeBluetoothChar) {
    throw new Error('Printer Bluetooth belum terhubung. Hubungkan dulu di Pengaturan > Printer Thermal.');
  }
  // Chunk to 180 bytes to respect BLE MTU limits across all thermal printer chipsets
  const chunkSize = 180;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.slice(offset, offset + chunkSize);
    if (activeBluetoothChar.writeValueWithoutResponse && activeBluetoothChar.properties?.writeWithoutResponse) {
      await activeBluetoothChar.writeValueWithoutResponse(slice);
    } else {
      await activeBluetoothChar.writeValue(slice);
    }
  }
}

async function sendBytesOverSerial(bytes: Uint8Array): Promise<void> {
  if (!activeSerialPort?.writable) {
    throw new Error('Port USB/Serial belum terhubung. Hubungkan dulu di Pengaturan > Printer Thermal.');
  }
  const writer = activeSerialPort.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

async function sendBytesOverNetwork(settings: StoreSettings, bytes: Uint8Array): Promise<void> {
  const endpoint = settings.printerNetworkBridgeUrl.trim();
  if (!endpoint) {
    throw new Error(
      'URL Print Bridge / Gateway LAN belum diisi (contoh: http://192.168.1.50:8765/print).'
    );
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: settings.printerNetworkIp,
      port: settings.printerNetworkPort,
      paperWidth: settings.receiptPaperWidth,
      escposBase64: uint8ToBase64(bytes),
    }),
  });
  if (!res.ok) {
    throw new Error(`Print Bridge merespons HTTP ${res.status}. Periksa IP/port printer LAN.`);
  }
}

/**
 * Unified receipt printing entry point used across POS PaymentModal, OrdersPage, and SettingsPage.
 * Routes automatically to Bluetooth BLE, WiFi/LAN Network Bridge, USB Serial, or OS Browser Print.
 */
export async function printOrderReceipt(
  settings: StoreSettings,
  order: OrderRecord,
  extras: ReceiptPrintExtras = {}
): Promise<PrinterActionResult> {
  const copies = Math.max(1, Math.min(3, settings.printerCopies || 1));

  if (settings.printerConnectionType === 'browser') {
    window.print();
    return {
      ok: true,
      channel: 'browser',
      message: 'Dialog cetak browser / driver thermal OS dibuka.',
    };
  }

  const escposBytes = buildEscPosReceiptBytes(settings, order, extras);

  try {
    for (let c = 0; c < copies; c++) {
      if (settings.printerConnectionType === 'bluetooth') {
        await sendBytesOverBluetooth(escposBytes);
      } else if (settings.printerConnectionType === 'usb_serial') {
        await sendBytesOverSerial(escposBytes);
      } else if (settings.printerConnectionType === 'network') {
        await sendBytesOverNetwork(settings, escposBytes);
      }
    }

    return {
      ok: true,
      channel: settings.printerConnectionType,
      message: `Struk ${order.order_number} berhasil dikirim (${copies}x, ${escposBytes.length} byte ESC/POS) melalui ${
        settings.printerConnectionType === 'bluetooth'
          ? `Bluetooth (${settings.printerDeviceName || 'Thermal Printer'})`
          : settings.printerConnectionType === 'network'
            ? `Jaringan LAN/WiFi (${settings.printerNetworkIp}:${settings.printerNetworkPort})`
            : `USB/Serial (${settings.printerBaudRate} bps)`
      }.`,
    };
  } catch (err) {
    // Graceful fallback to browser print when hardware isn't connected in current browser session
    const detail = err instanceof Error ? err.message : 'Gagal mengirim data ke printer thermal.';
    return {
      ok: false,
      channel: settings.printerConnectionType,
      message: `${detail} Anda tetap dapat menggunakan Cetak Driver Browser sebagai cadangan.`,
    };
  }
}
