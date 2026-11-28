import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDailySequence,
  formatOrderDateStamp,
  generateCollisionRetryOrderNumber,
  generateNextOrderNumber,
} from './orderNumber';

test('formatOrderDateStamp formats local YYMMDD accurately', () => {
  const date = new Date(2026, 10, 27, 9, 30, 0); // 2026-11-27
  assert.equal(formatOrderDateStamp(date), '261127');
});

test('generateNextOrderNumber uses max sequence for today and ignores older dates or array length', () => {
  const today = new Date(2026, 10, 27, 10, 0, 0);
  const existing = [
    'BF-261125-099', // older date must be ignored
    'BF-261127-005',
    'BF-261127-014', // even with only 3 items in array, next MUST be 015 (not length+2=005!)
  ];
  assert.equal(generateNextOrderNumber(existing, today), 'BF-261127-015');
  assert.equal(extractDailySequence('BF-261127-014', '261127'), 14);
  assert.equal(generateNextOrderNumber([], today), 'BF-261127-001');
});

test('generateCollisionRetryOrderNumber increments sequence cleanly on unique violation retry', () => {
  assert.equal(generateCollisionRetryOrderNumber('BF-261127-015', 1), 'BF-261127-016');
  assert.equal(generateCollisionRetryOrderNumber('BF-261127-015', 3), 'BF-261127-018');
});
