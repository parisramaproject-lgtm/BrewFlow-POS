import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppNotification } from '../types';
import {
  buildVendorOrderMessage,
  buildVendorWhatsAppUrl,
  countUnreadForRole,
  isNotificationVisibleForRole,
  normalizeVendorWhatsAppPhone,
} from './operationalNotifications';

const sampleNotifs: AppNotification[] = [
  {
    id: 'n1',
    type: 'new_order',
    title: 'Orderan Masuk #BF-001',
    message: 'Rp 65.000 oleh Kasir Dimas',
    targetPage: 'orders',
    targetRoles: ['owner', 'manager'],
    timestamp: 'Baru saja',
    unread: true,
  },
  {
    id: 'n2',
    type: 'owner_message',
    title: 'Pesan dari Owner',
    message: 'Pastikan stok susu dicek sebelum shift sore.',
    targetPage: 'pos',
    targetRoles: ['cashier'],
    timestamp: 'Baru saja',
    unread: true,
  },
  {
    id: 'n3',
    type: 'restock_request',
    title: 'Permintaan Restock dari Kasir',
    message: 'Susu Fresh Milk hampir habis, butuh 5000 ml.',
    targetPage: 'purchasing',
    targetRoles: ['owner', 'manager'],
    timestamp: 'Baru saja',
    unread: false,
  },
];

test('isNotificationVisibleForRole and countUnreadForRole enforce strict role targeting', () => {
  assert.equal(isNotificationVisibleForRole(sampleNotifs[0], 'owner'), true);
  assert.equal(isNotificationVisibleForRole(sampleNotifs[0], 'cashier'), false);
  assert.equal(isNotificationVisibleForRole(sampleNotifs[1], 'cashier'), true);
  assert.equal(isNotificationVisibleForRole(sampleNotifs[1], 'owner'), false);

  assert.equal(countUnreadForRole(sampleNotifs, 'owner'), 1);
  assert.equal(countUnreadForRole(sampleNotifs, 'cashier'), 1);
});

test('normalizeVendorWhatsAppPhone converts Indonesian formats to 62xxx', () => {
  assert.equal(normalizeVendorWhatsAppPhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeVendorWhatsAppPhone('+62 813 9988 7766'), '6281399887766');
  assert.equal(normalizeVendorWhatsAppPhone('85712345678'), '6285712345678');
  assert.equal(normalizeVendorWhatsAppPhone(''), '');
});

test('buildVendorOrderMessage and buildVendorWhatsAppUrl generate formatted PO text & link', () => {
  const msg = buildVendorOrderMessage({
    vendor: { name: 'PT Kopi Nusantara', contact_person: 'Pak Budi' },
    shopName: 'BrewFlow Coffee',
    items: [
      { itemName: 'Biji Kopi Arabica', quantity: 5000, unit: 'gr' },
      { itemName: 'Sirup Gula Aren', quantity: 2000, unit: 'ml' },
    ],
    notes: 'Mohon dikirim besok pagi sebelum jam 09:00.',
  });

  assert.ok(msg.includes('Halo Pak Budi (PT Kopi Nusantara)'));
  assert.ok(msg.includes('1. Biji Kopi Arabica — 5000 gr'));
  assert.ok(msg.includes('2. Sirup Gula Aren — 2000 ml'));
  assert.ok(msg.includes('Mohon dikirim besok pagi sebelum jam 09:00.'));

  const url = buildVendorWhatsAppUrl('0812-8800-1122', msg);
  assert.ok(url?.startsWith('https://wa.me/6281288001122?text='));
});
