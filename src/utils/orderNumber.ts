/**
 * Daily sequential order number generator (BF-YYMMDD-NNN).
 * Computes the next sequence from the maximum existing sequence for that local date
 * (never from `orders.length` and never with a hardcoded date), preventing collisions
 * across page reloads and multi-device sync.
 */

export function formatOrderDateStamp(date: Date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

export function extractDailySequence(orderNumber: string, dateStamp: string): number {
  const prefix = `BF-${dateStamp}-`;
  if (!orderNumber.startsWith(prefix)) return 0;
  const suffix = orderNumber.slice(prefix.length);
  const match = /^(\d+)/.exec(suffix);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function generateNextOrderNumber(
  existingOrderNumbers: readonly string[],
  date: Date = new Date()
): string {
  const dateStamp = formatOrderDateStamp(date);
  let maxSeq = 0;
  for (const num of existingOrderNumbers) {
    const seq = extractDailySequence(num, dateStamp);
    if (seq > maxSeq) {
      maxSeq = seq;
    }
  }
  const nextSeq = maxSeq + 1;
  return `BF-${dateStamp}-${String(nextSeq).padStart(3, '0')}`;
}

export function generateCollisionRetryOrderNumber(
  baseOrderNumber: string,
  attempt: number
): string {
  const match = /^(BF-\d{6}-)(\d+)$/.exec(baseOrderNumber.trim());
  if (match) {
    const nextSeq = Number.parseInt(match[2], 10) + Math.max(1, attempt);
    return `${match[1]}${String(nextSeq).padStart(3, '0')}`;
  }
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `${baseOrderNumber}-${attempt}${randomSuffix}`;
}
