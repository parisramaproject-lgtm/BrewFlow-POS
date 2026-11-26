import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { StockOpnameSchedule } from '../types';
import {
  getCategoryTargetLabel,
  getFrequencyDescription,
  isOpnameScheduleDue,
} from './opnameScheduler';

const BASE_SCHEDULE: StockOpnameSchedule = {
  id: 'sch-test',
  title: 'Opname Harian Bar',
  frequency: 'daily',
  execution_time: '21:00',
  target_category: 'raw_material',
  is_active: true,
  is_due_now: false,
};

describe('opnameScheduler', () => {
  it('marks daily schedule due once current local time passes execution_time', () => {
    const before = new Date(2026, 10, 25, 20, 59);
    const after = new Date(2026, 10, 25, 21, 5);
    assert.equal(isOpnameScheduleDue(BASE_SCHEDULE, before), false);
    assert.equal(isOpnameScheduleDue(BASE_SCHEDULE, after), true);
  });

  it('suppresses due status if already completed today', () => {
    const now = new Date(2026, 10, 25, 22, 0);
    const completedToday: StockOpnameSchedule = {
      ...BASE_SCHEDULE,
      is_due_now: true,
      last_completed_at: new Date(2026, 10, 25, 21, 15).toISOString(),
    };
    assert.equal(isOpnameScheduleDue(completedToday, now), false);
  });

  it('evaluates weekly schedule strictly on matching day_of_week', () => {
    // 2026-11-25 is Wednesday (getDay() === 3)
    const wednesdayEvening = new Date(2026, 10, 25, 21, 30);
    const weeklyWed: StockOpnameSchedule = {
      ...BASE_SCHEDULE,
      frequency: 'weekly',
      day_of_week: 3,
      execution_time: '21:00',
    };
    const weeklySun: StockOpnameSchedule = {
      ...weeklyWed,
      day_of_week: 0,
    };
    assert.equal(isOpnameScheduleDue(weeklyWed, wednesdayEvening), true);
    assert.equal(isOpnameScheduleDue(weeklySun, wednesdayEvening), false);
  });

  it('evaluates monthly schedule strictly on matching day_of_month and skips inactive schedules', () => {
    const nov25 = new Date(2026, 10, 25, 19, 0);
    const monthly25: StockOpnameSchedule = {
      ...BASE_SCHEDULE,
      frequency: 'monthly',
      day_of_month: 25,
      execution_time: '18:00',
    };
    const inactive: StockOpnameSchedule = { ...monthly25, is_active: false };
    assert.equal(isOpnameScheduleDue(monthly25, nov25), true);
    assert.equal(isOpnameScheduleDue(inactive, nov25), false);
  });

  it('formats Indonesian schedule descriptions and target labels accurately', () => {
    assert.equal(
      getFrequencyDescription({
        ...BASE_SCHEDULE,
        frequency: 'weekly',
        day_of_week: 5,
        execution_time: '22:00',
      }),
      'Setiap Jumat · 22:00 WIB'
    );
    assert.equal(
      getFrequencyDescription({
        ...BASE_SCHEDULE,
        frequency: 'monthly',
        day_of_month: 28,
        execution_time: '20:30',
      }),
      'Setiap Tanggal 28 · 20:30 WIB'
    );
    assert.equal(getCategoryTargetLabel('asset'), 'Aset Coffee Shop');
  });
});
