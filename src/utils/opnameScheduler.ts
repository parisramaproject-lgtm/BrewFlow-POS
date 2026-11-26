import type { ItemCategoryType, OpnameFrequency, StockOpnameSchedule } from '../types';

export const INDONESIAN_DAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Minggu' },
  { value: 1, label: 'Senin' },
  { value: 2, label: 'Selasa' },
  { value: 3, label: 'Rabu' },
  { value: 4, label: 'Kamis' },
  { value: 5, label: 'Jumat' },
  { value: 6, label: 'Sabtu' },
];

export function getDayLabel(dayOfWeek?: number): string {
  const found = INDONESIAN_DAYS.find((d) => d.value === dayOfWeek);
  return found ? found.label : 'Senin';
}

export function getCategoryTargetLabel(target: ItemCategoryType | 'all'): string {
  switch (target) {
    case 'raw_material':
      return 'Bahan Baku';
    case 'packaging':
      return 'Kemasan';
    case 'asset':
      return 'Aset Coffee Shop';
    case 'operational':
      return 'Operasional & Lainnya';
    case 'all':
      return 'Semua Kategori';
  }
}

export function getFrequencyDescription(schedule: StockOpnameSchedule): string {
  if (schedule.frequency === 'daily') {
    return `Setiap Hari · ${schedule.execution_time} WIB`;
  }
  if (schedule.frequency === 'weekly') {
    return `Setiap ${getDayLabel(schedule.day_of_week)} · ${schedule.execution_time} WIB`;
  }
  const dayNum = schedule.day_of_month ?? 1;
  return `Setiap Tanggal ${dayNum} · ${schedule.execution_time} WIB`;
}

export function getFrequencyLabel(frequency: OpnameFrequency): string {
  if (frequency === 'daily') return 'Harian';
  if (frequency === 'weekly') return 'Mingguan';
  return 'Bulanan';
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Pure function: evaluates whether a scheduled stock opname is currently due
 * and has not yet been completed today.
 */
export function isOpnameScheduleDue(
  schedule: StockOpnameSchedule,
  now: Date = new Date()
): boolean {
  if (!schedule.is_active) return false;

  // If already completed today, it is no longer due
  if (schedule.last_completed_at) {
    const completedDate = new Date(schedule.last_completed_at);
    if (!Number.isNaN(completedDate.getTime()) && isSameLocalCalendarDay(completedDate, now)) {
      return false;
    }
  }

  // Respect explicit due flag (e.g. manual trigger)
  if (schedule.is_due_now) {
    return true;
  }

  const [hourStr, minuteStr] = schedule.execution_time.split(':');
  const targetHour = Number(hourStr);
  const targetMinute = Number(minuteStr);
  if (Number.isNaN(targetHour) || Number.isNaN(targetMinute)) {
    return false;
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = targetHour * 60 + targetMinute;

  if (nowMinutes < targetMinutes) {
    return false;
  }

  if (schedule.frequency === 'daily') {
    return true;
  }

  if (schedule.frequency === 'weekly') {
    return now.getDay() === (schedule.day_of_week ?? 0);
  }

  if (schedule.frequency === 'monthly') {
    return now.getDate() === (schedule.day_of_month ?? 1);
  }

  return false;
}
