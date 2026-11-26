import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderRecord, StoreSettings } from '../types';
import { buildEscPosReceiptBytes } from './thermalPrinterService';
import { normalizeWhatsAppPhone } from './whatsappService';

const SAMPLE_SETTINGS: StoreSettings = {
  shopName: 'BrewFlow Coffee & Roastery',
  address: 'Jl. Kemang Raya No. 42',
  phone: '021-7192-4410',
  customerServiceContact: 'WA 0812-8800-1101',
  shopLogoUrl: null,
  taxEnabled: true,
  taxPercent: 10,
  taxLabel: 'PB1',
  receiptPaperWidth: '58mm',
  receiptHeaderText: 'Specialty Coffee',
  receiptFooterText: 'Terima kasih!',
  receiptShowLogo: true,
  receiptShowCashierAndTable: true,
  receiptShowMemberInfo: true,
  receiptShowCustomerService: true,
  printerConnectionType: 'bluetooth',
  printerDeviceName: 'Xprinter-58BT',
  printerNetworkIp: '192.168.1.100',
  printerNetworkPort: 9100,
  printerNetworkBridgeUrl: 'http://localhost:8765/print',
  printerBaudRate: 9600,
  printerAutoCut: true,
  printerOpenCashDrawer: true,
  printerAutoPrintAfterPayment: false,
  printerCopies: 1,
  whatsappGatewayProvider: 'fonnte',
  whatsappGatewayUrl: 'https://api.fonnte.com/send',
  whatsappOwnerPhone: '0812-8800-1101',
  whatsappManagerPhone: '0813-7721-4402',
  whatsappAutoReceipt: true,
  whatsappAutoOpnameReminder: true,
  whatsappAutoLowStock: true,
};

const SAMPLE_ORDER: OrderRecord = {
  id: 'ord-1',
  order_number: 'BF-261125-010',
  cashier_id: 'u-1',
  cashier_name: 'Nadia Putri',
  customer_id: 'c-1',
  customer_name: 'Raka Pratama',
  order_type: 'dine_in',
  table_number: 'Meja 03',
  subtotal: 56000,
  discount_amount: 0,
  tax_amount: 5600,
  total_amount: 61600,
  payment_method: 'cash',
  status: 'completed',
  notes: '',
  items: [
    {
      id: 'oi-1',
      menu_id: 'm-1',
      menu_name: 'Es Kopi Susu Gula Aren',
      quantity: 2,
      unit_price: 28000,
      subtotal: 56000,
    },
  ],
  created_at: '2026-11-25T10:00:00.000Z',
};

describe('thermalPrinterService & whatsappService pure helpers', () => {
  it('encodes ESC/POS receipt with init header, store & item text, cash drawer pulse, and auto-cut', () => {
    const bytes = buildEscPosReceiptBytes(SAMPLE_SETTINGS, SAMPLE_ORDER, {
      cashReceived: 100000,
      cashChange: 38400,
      pointsEarned: 6,
    });

    // Starts with ESC @ (0x1B 0x40)
    assert.equal(bytes[0], 0x1b);
    assert.equal(bytes[1], 0x40);

    // Ends with Auto-Cut GS V 66 3 (0x1D 0x56 0x42 0x03)
    const len = bytes.length;
    assert.deepEqual(Array.from(bytes.slice(len - 4)), [0x1d, 0x56, 0x42, 0x03]);
    // Preceded by Cash Drawer Kick ESC p 0 25 250 (0x1B 0x70 0x00 0x19 0xFA)
    assert.deepEqual(Array.from(bytes.slice(len - 9, len - 4)), [0x1b, 0x70, 0x00, 0x19, 0xfa]);

    const decoded = new TextDecoder().decode(bytes);
    assert.match(decoded, /BREWFLOW COFFEE & ROASTERY/);
    assert.match(decoded, /BF-261125-010/);
    assert.match(decoded, /Es Kopi Susu Gula Aren/);
    assert.match(decoded, /WA 0812-8800-1101/);
  });

  it('uses 48-column dividers for 80mm paper and omits auto-cut when disabled', () => {
    const bytes = buildEscPosReceiptBytes(
      {
        ...SAMPLE_SETTINGS,
        receiptPaperWidth: '80mm',
        printerAutoCut: false,
        printerOpenCashDrawer: false,
      },
      SAMPLE_ORDER
    );
    const decoded = new TextDecoder().decode(bytes);
    assert.ok(decoded.includes('-'.repeat(48)));
    assert.notDeepEqual(Array.from(bytes.slice(bytes.length - 4)), [0x1d, 0x56, 0x42, 0x03]);
  });

  it('normalizes Indonesian phone numbers for WhatsApp gateway', () => {
    assert.equal(normalizeWhatsAppPhone('0812-8800-1101'), '6281288001101');
    assert.equal(normalizeWhatsAppPhone('+62 813 7721 4402'), '6281377214402');
    assert.equal(normalizeWhatsAppPhone('81299990000'), '6281299990000');
    assert.equal(normalizeWhatsAppPhone(''), '');
  });
});
