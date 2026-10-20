/**
 * The owner's order history (/admin/orders): date ranges, filters and search.
 *
 * Pure functions, so the page stays thin and the rules are unit-testable. The
 * money figures deliberately come from ./reports (`buildReport`), not from here,
 * so the history page and the reports page can never disagree about a day's
 * takings.
 */

import { ACTIVE_STATUSES, ORDER_STATUSES } from "./order-status";
import type { Range } from "./reports";
import type { Order } from "./types";

const DAY_MS = 86_400_000;

/**
 * Longest range one fetch may cover. A month is what an owner looks back over;
 * anything longer is one bounded query that could still read thousands of
 * documents, so it is refused with an explanation instead.
 */
export const MAX_RANGE_DAYS = 31;

/**
 * Most orders one fetch will read. Well above a busy month for one cafe, and
 * about 2% of the Spark plan's 50,000 free reads a day. When a range has more,
 * the newest are shown and the page says so.
 */
export const HISTORY_LIMIT = 1000;

export type PresetId = "today" | "yesterday" | "last7" | "month";

export const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "month", label: "This month" },
];

function dayStart(ms: number, offsetDays = 0): number {
  const d = new Date(ms);
  // Date arithmetic, not `+ n * DAY_MS`, so a DST change can't shift a day
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + offsetDays,
  ).getTime();
}

/** Local-time range for a quick chip. `to` is exclusive. */
export function presetRange(id: PresetId, now = Date.now()): Range {
  switch (id) {
    case "today":
      return { from: dayStart(now), to: dayStart(now, 1) };
    case "yesterday":
      return { from: dayStart(now, -1), to: dayStart(now) };
    case "last7":
      // today and the six days before it
      return { from: dayStart(now, -6), to: dayStart(now, 1) };
    case "month": {
      const d = new Date(now);
      return {
        from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        to: dayStart(now, 1),
      };
    }
  }
}

/** "2026-09-28" in local time, for <input type="date">. */
export function toInputDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromInputDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
}

export type RangeCheck =
  { ok: true; range: Range; days: number } | { ok: false; reason: string };

/** Turns the two date inputs (both inclusive) into a query range, or says why not. */
export function inputRange(from: string, to: string): RangeCheck {
  const start = fromInputDate(from);
  const end = fromInputDate(to);
  if (start === null || end === null) {
    return { ok: false, reason: "Pick both a start and an end date." };
  }
  if (end < start) {
    return { ok: false, reason: "The end date is before the start date." };
  }
  const range = { from: start, to: dayStart(end, 1) };
  const days = Math.round((range.to - range.from) / DAY_MS);
  if (days > MAX_RANGE_DAYS) {
    return {
      ok: false,
      reason: `That's ${days} days. History looks back at most ${MAX_RANGE_DAYS} days at a time, so each look stays inside the free database allowance — pick a shorter range, or use Reports for monthly totals.`,
    };
  }
  return { ok: true, range, days };
}

/** Which chip, if any, the two date inputs currently match. */
export function matchingPreset(
  from: string,
  to: string,
  now = Date.now(),
): PresetId | null {
  for (const { id } of PRESETS) {
    const r = presetRange(id, now);
    if (toInputDate(r.from) === from && toInputDate(r.to - 1) === to) return id;
  }
  return null;
}

// --- filters ---------------------------------------------------------------

/**
 * "all", "active" (anything still on the staff board), or one terminal status.
 * Terminal statuses are derived from ORDER_STATUSES, so a new one — "rejected",
 * say — gets its own filter the moment it joins the union.
 */
export type StatusFilter = "all" | "active" | (string & {});

export const TERMINAL_STATUSES: readonly string[] = ORDER_STATUSES.filter(
  (s) => !(ACTIVE_STATUSES as readonly string[]).includes(s),
);

export interface HistoryFilters {
  status: StatusFilter;
  /** null = every table */
  table: number | null;
  search: string;
}

export const NO_FILTERS: HistoryFilters = {
  status: "all",
  table: null,
  search: "",
};

function matchesStatus(order: Order, status: StatusFilter): boolean {
  if (status === "all") return true;
  if (status === "active") {
    return (ACTIVE_STATUSES as readonly string[]).includes(order.status);
  }
  return order.status === status;
}

/**
 * Digits (with or without "#") match the order number; anything else matches
 * an item name.
 *
 * An order with today's number is matched on it: "#0007", "0007" and "7" all
 * find #0007, and, as before, a part of a number finds every number containing
 * it ("7" also finds #0017). Leading zeros are ignored, so "07" works too. An
 * order from before daily numbers is matched on its older short number.
 * Daily numbers repeat every day — every day has a #0007 — which is why every
 * row also shows the date, time and table, and the date range narrows it.
 */
function matchesSearch(order: Order, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const digits = /^#?\s*(\d+)$/.exec(q);
  if (digits) {
    if (order.dayNumber === undefined) {
      return String(order.orderNumber).includes(digits[1]);
    }
    const wanted = digits[1].replace(/^0+(?=\d)/, "");
    return String(order.dayNumber).includes(wanted);
  }
  return order.items.some((line) => line.name.toLowerCase().includes(q));
}

/** Newest first. */
export function filterOrders(
  orders: readonly Order[],
  filters: HistoryFilters,
): Order[] {
  return orders
    .filter(
      (o) =>
        matchesStatus(o, filters.status) &&
        (filters.table === null || o.tableNumber === filters.table) &&
        matchesSearch(o, filters.search),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function tablesIn(orders: readonly Order[]): number[] {
  return [...new Set(orders.map((o) => o.tableNumber))].sort((a, b) => a - b);
}

export function itemCount(order: Order): number {
  return order.items.reduce((sum, line) => sum + line.qty, 0);
}

/**
 * Why staff refused an order, when they said. Read defensively rather than
 * typed on Order: the field arrives with the "rejected" status, and this lets
 * the page show it as soon as the order parser passes it through.
 */
export function rejectReasonOf(order: Order): string | null {
  const value = (order as Order & { rejectReason?: unknown }).rejectReason;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
