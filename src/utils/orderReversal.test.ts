import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderReversal } from './orderReversal';
import { INITIAL_CUSTOMERS, INITIAL_INVENTORY, INITIAL_MENUS } from '../data/seedData';
import type { OrderRecord } from '../types';

test('computeOrderReversal restores recipe stock, member points, and voucher quota on completed order', () => {
  const sampleMenu = INITIAL_MENUS[0];
  const sampleCustomer = INITIAL_CUSTOMERS[0];
  const completedOrder: OrderRecord = {
    id: 'ord-rev-1',
    order_number: 'BF-261127-001',
    cashier_id: 'emp-1',
    cashier_name: 'Kasir',
    customer_id: sampleCustomer.id,
    customer_name: sampleCustomer.name,
    order_type: 'dine_in',
    table_number: 'Meja 01',
    subtotal: sampleMenu.selling_price * 2,
    discount_amount: 0,
    voucher_code: 'RUSHPAGI20',
    voucher_discount_amount: 5000,
    tax_amount: 0,
    total_amount: 50000,
    points_earned: 5,
    payment_method: 'qris',
    status: 'completed',
    notes: '',
    items: [
      {
        id: 'oi-1',
        menu_id: sampleMenu.id,
        menu_name: sampleMenu.name,
        quantity: 2,
        unit_price: sampleMenu.selling_price,
        subtotal: sampleMenu.selling_price * 2,
      },
    ],
    created_at: new Date().toISOString(),
  };

  const result = computeOrderReversal({
    order: completedOrder,
    menus: INITIAL_MENUS,
    inventory: INITIAL_INVENTORY,
    customers: INITIAL_CUSTOMERS,
  });

  assert.ok(result.restoredStock.length > 0);
  const firstRecipe = sampleMenu.recipes[0];
  const originalInv = INITIAL_INVENTORY.find((i) => i.id === firstRecipe.inventory_item_id)!;
  const restoredInv = result.updatedInventory.find((i) => i.id === firstRecipe.inventory_item_id)!;
  assert.equal(
    restoredInv.current_stock,
    Number((originalInv.current_stock + firstRecipe.quantity_needed * 2).toFixed(2))
  );

  assert.equal(result.pointsReversed, 5);
  assert.ok(result.updatedCustomer);
  assert.equal(result.updatedCustomer.points, Math.max(0, sampleCustomer.points - 5));
  assert.equal(result.voucherCodeToRestore, 'RUSHPAGI20');
});

test('computeOrderReversal is a no-op for draft or already cancelled orders', () => {
  const draftOrder: OrderRecord = {
    id: 'ord-draft-1',
    order_number: 'BF-261127-002',
    cashier_id: 'emp-1',
    cashier_name: 'Kasir',
    customer_id: null,
    customer_name: null,
    order_type: 'takeaway',
    table_number: 'Takeaway',
    subtotal: 28000,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 28000,
    payment_method: 'cash',
    status: 'draft',
    notes: '',
    items: [],
    created_at: new Date().toISOString(),
  };

  const result = computeOrderReversal({
    order: draftOrder,
    menus: INITIAL_MENUS,
    inventory: INITIAL_INVENTORY,
    customers: INITIAL_CUSTOMERS,
  });

  assert.equal(result.restoredStock.length, 0);
  assert.equal(result.updatedCustomer, null);
  assert.equal(result.voucherCodeToRestore, null);
});
