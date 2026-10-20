/**
 * The number a barista reads out ("table four, number seven").
 *
 * Today: a per-day sequence, #0001, #0002, …, that starts again at midnight in
 * the cafe's time zone (India, UTC+5:30). The owner asked for it. It is written
 * onto the order as `dayNumber` (1–9999) with the `dayKey` of the day it
 * belongs to ("2026-09-28"), and it is assigned by the STAFF BOARD, not by the
 * customer's phone:
 *
 *   - The board sees an order with no number and, in one transaction, reads
 *     dayCounters/{dayKey} = { next }, re-reads the order, writes the number on
 *     it and bumps the counter (src/lib/day-number.ts).
 *   - firestore.rules only lets a staff account do that, only once per order,
 *     and only as `counter.next` before and `next + 1` after in the same commit,
 *     so two boards racing cannot hand out the same number: one transaction
 *     wins, the other sees the number already set and stops.
 *   - The day comes from the order's createdAt in IST, never from the time it
 *     was numbered or the device's clock, so an order placed at 23:59:59 is in
 *     that day's sequence even if it is numbered after midnight.
 *
 * Why this is safe where the old /meta/counters was not (issue #30): that
 * counter was bumped by customers, so it had to be writable by the whole
 * internet. This one is only ever touched by signed-in staff.
 *
 * The cost: numbers only appear while a board is open (the customer sees
 * "number coming…" until then), and each order costs one more transaction
 * (reads of the order and the counter, two writes). Rejected orders keep their
 * number, so the sequence can have gaps.
 *
 * Older orders fall back, in order, to:
 *   1. a stored `orderNumber` from the original public counter, then
 *   2. a three-digit number derived from the document id (below), which is
 *      what orders placed between issue #30 and daily numbers showed. It is not
 *      unique, which is why it was always shown next to the table.
 */

export const DISPLAY_NUMBER_MIN = 100;
export const DISPLAY_NUMBER_MAX = 999;
const SPAN = DISPLAY_NUMBER_MAX - DISPLAY_NUMBER_MIN + 1;

/**
 * FNV-1a (32-bit) over the id, folded into 100–999. Deterministic, so every
 * device that reads the same document shows the same number, and there is no
 * dependency to ship to the customer's phone for it.
 */
export function displayNumberFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return DISPLAY_NUMBER_MIN + (hash % SPAN);
}

/**
 * The fallback number for an order with no day number: the stored one if the
 * document predates the derived scheme, otherwise the one derived from the id.
 */
export function resolveOrderNumber(id: string, stored: unknown): number {
  if (typeof stored === "number" && Number.isInteger(stored) && stored > 0) {
    return stored;
  }
  return displayNumberFromId(id);
}

// --- daily numbers ------------------------------------------------------------

export const DAY_NUMBER_MAX = 9999;

/** India has no daylight saving, so this offset is fixed all year. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/**
 * The cafe day an instant belongs to, as "YYYY-MM-DD" in IST. Computed from the
 * UTC time plus 5h30m explicitly, so a phone or laptop set to any other time
 * zone still files the order under the cafe's day. firestore.rules does the
 * same sum (dayKeyOf) and refuses a key that disagrees.
 */
export function istDayKey(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isDayNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= DAY_NUMBER_MAX
  );
}

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 7 -> "0007". */
export function padDayNumber(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * What to print for an order, with the "#": "#0007" once it has a day number,
 * otherwise the older fallback ("#417"). History, reports and the CSV use this.
 * The live screens use `dayNumber` directly, so they can say "number coming…"
 * instead of showing a fallback that is about to change.
 */
export function orderLabel(order: {
  dayNumber?: number;
  orderNumber: number;
}): string {
  return isDayNumber(order.dayNumber)
    ? `#${padDayNumber(order.dayNumber)}`
    : `#${order.orderNumber}`;
}

/**
 * How long the customer's screen says "number coming…" before it gives up and
 * says the counter will call the table instead. A board that is open numbers
 * an order within a second or two; this only runs out when no board is open,
 * or an older board that does not number orders is.
 */
export const NUMBER_WAIT_MS = 45_000;
