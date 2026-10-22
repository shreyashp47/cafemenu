/**
 * Report aggregation (docs/requirements.md §4.3 steps 3–4, §5.4).
 *
 * Pure functions over an order list so the maths can be unit-tested and reused
 * by both the dashboard and the CSV export. Every amount is an integer in the
 * cafe's money unit (src/lib/money.ts); only the CSV turns them into decimals.
 *
 * Days and months are the cafe's, in its time zone (settings.timeZone), not
 * the zone of whatever device the owner opens the page on: a day's bar is the
 * same orders the day's numbers count, wherever the owner is.
 */

import {
  addMonths,
  dayKeyIn,
  dayStartIn,
  moneyToDecimal,
  wallTimeIn,
  type MoneySettings,
} from "@cafemenu/shared";

import { orderTotal } from "./money";
import { orderLabel } from "./order-number";
import type { Order } from "./types";

export interface Range {
  /** inclusive */
  from: number;
  /** exclusive */
  to: number;
}

export interface TopItem {
  name: string;
  qty: number;
  revenue: number;
  /** 0–1 share of revenue */
  share: number;
}

export interface DayBucket {
  /** YYYY-MM-DD in the cafe's time zone */
  date: string;
  /** "22 Sept" — used where there is room for it */
  label: string;
  /** 22 — used for a dense axis, where "22 Sept" would collide */
  dayOfMonth: number;
  revenue: number;
  orders: number;
}

export interface Report {
  range: Range;
  orderCount: number;
  revenue: number;
  /** 0 when there were no orders */
  averageOrderValue: number;
  topItems: TopItem[];
  byDay: DayBucket[];
  /** Per-status counts, so the owner can see how many closed out. */
  statusCounts: Record<string, number>;
  /**
   * Orders staff rejected in the range. Counted here and nowhere else: they
   * were never made or paid for, so they are left out of revenue, the order
   * count, best sellers and the daily chart.
   */
  rejectedCount: number;
  /**
   * Orders still waiting for staff to confirm the table (`pending`). Left out
   * of the figures the same way: nothing has been made yet, and most of them
   * will either be accepted (and then count) or turned away.
   */
  pendingCount: number;
}

/**
 * Whether an order counts towards takings. Rejected orders never do; pending
 * ones (waiting for the counter to confirm the table) not yet.
 */
export function countsAsSale(order: Pick<Order, "status">): boolean {
  return order.status !== "rejected" && order.status !== "pending";
}

// A calendar date, not an instant: formatted at noon UTC, in UTC, so neither
// the device's zone nor a daylight-saving change can move it to another day.
const dayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function dayLabelOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayLabel.format(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
}

/** "2026-03-01" for (2026, 2). */
function firstOfMonth(year: number, month0: number): string {
  return addMonths(`${String(year).padStart(4, "0")}-01-01`, month0);
}

/**
 * A month in the cafe's zone, from its first midnight to the next month's.
 * `to` is exclusive so month ends don't overlap.
 */
export function monthRange(
  year: number,
  month0: number,
  timeZone: string,
): Range {
  const first = firstOfMonth(year, month0);
  return {
    from: dayStartIn(timeZone, first),
    to: dayStartIn(timeZone, addMonths(first, 1)),
  };
}

/** The month it is now at the cafe. */
export function currentMonth(
  timeZone: string,
  now = Date.now(),
): {
  year: number;
  month0: number;
} {
  const today = dayKeyIn(timeZone, now);
  return {
    year: Number(today.slice(0, 4)),
    month0: Number(today.slice(5, 7)) - 1,
  };
}

export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const months = year * 12 + month0 + delta;
  return { year: Math.floor(months / 12), month0: ((months % 12) + 12) % 12 };
}

/** Totals for the orders placed in `range`, by day in the cafe's `timeZone`. */
export function buildReport(
  orders: Order[],
  range: Range,
  timeZone: string,
): Report {
  const inRange = orders
    .filter((o) => o.createdAt >= range.from && o.createdAt < range.to)
    .sort((a, b) => a.createdAt - b.createdAt);

  const sales = inRange.filter(countsAsSale);
  const revenue = sales.reduce((sum, o) => sum + orderTotal(o.items), 0);
  const orderCount = sales.length;

  const byName = new Map<string, { qty: number; revenue: number }>();
  const dayMap = new Map<string, { revenue: number; orders: number }>();
  const statusCounts: Record<string, number> = {};

  for (const order of inRange) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
  }

  for (const order of sales) {
    const key = dayKeyIn(timeZone, order.createdAt);
    const bucket = dayMap.get(key) ?? { revenue: 0, orders: 0 };
    bucket.revenue += orderTotal(order.items);
    bucket.orders += 1;
    dayMap.set(key, bucket);

    for (const line of order.items) {
      const entry = byName.get(line.name) ?? { qty: 0, revenue: 0 };
      entry.qty += line.qty;
      entry.revenue += line.price * line.qty;
      byName.set(line.name, entry);
    }
  }

  const topItems: TopItem[] = [...byName.entries()]
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      revenue: v.revenue,
      share: revenue > 0 ? v.revenue / revenue : 0,
    }))
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name),
    );

  const byDay: DayBucket[] = [...dayMap.entries()]
    .map(([date, v]) => ({
      date,
      label: dayLabelOf(date),
      dayOfMonth: Number(date.slice(8, 10)),
      revenue: v.revenue,
      orders: v.orders,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    orderCount,
    revenue,
    averageOrderValue: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    topItems,
    byDay,
    statusCounts,
    rejectedCount: inRange.filter((o) => o.status === "rejected").length,
    pendingCount: inRange.filter((o) => o.status === "pending").length,
  };
}

/** Peak day, used to scale the CSS bar chart without a charting library. */
export function peakDay(byDay: DayBucket[]): number {
  return byDay.reduce((max, d) => Math.max(max, d.revenue), 0);
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Order-line level CSV — what an accountant actually wants.
 *
 * "Order ID" is the database id, and it is the column to group lines by. The
 * "Order #" is the number the customer was given, "#0007", as on screen. It is
 * not unique across a month: it starts again at #0001 every day, and orders
 * from before daily numbers carry an older short number that repeats. So
 * grouping on it would merge orders. The "#" keeps a spreadsheet from turning
 * "0007" into 7.
 *
 * "Placed at" is UTC (ISO 8601), as it always was, so existing sheets keep
 * working. "Placed (Europe/London)" is the same moment as the cafe's own date
 * and time, "2026-09-28 23:59", whatever zone the device is in: the date there
 * is the day an order's number counts in. The column names the zone (see
 * csvZoneName). When the clocks go back, an hour of local times happens twice;
 * "Placed at" tells those orders apart.
 *
 * Rejected orders stay in the export, with "rejected" in the Status column and
 * the staff's reason, so the file is a complete record. Anyone summing it for
 * takings must filter on Status, the way the dashboard does.
 *
 * Amounts are plain decimals in the cafe's currency, every decimal place
 * written ("180.00", "4.50", "1200" for yen), with no symbol or grouping, so a
 * spreadsheet reads them as numbers in any locale. The last column names the
 * currency. While a cafe keeps whole units (TOE until #21) they are whole
 * numbers, as they always were.
 */
export function ordersToCsv(
  orders: Order[],
  timeZone: string,
  money: MoneySettings,
): string {
  const amount = (n: number) => moneyToDecimal(n, money, { padded: true });
  const header = [
    "Order #",
    "Order ID",
    "Table",
    "Placed at",
    `Placed (${csvZoneName(timeZone)})`,
    "Status",
    "Completed at",
    "Item",
    "Qty",
    "Unit price",
    "Line total",
    "Order total",
    "Payment",
    "Notes",
    "Reject reason",
    "Currency",
  ];

  const rows: string[] = [];
  const fmt = (ms?: number) => (ms ? new Date(ms).toISOString() : "");

  for (const order of [...orders].sort((a, b) => a.createdAt - b.createdAt)) {
    const total = orderTotal(order.items);
    for (const line of order.items) {
      rows.push(
        [
          orderLabel(order),
          order.id,
          order.tableNumber,
          fmt(order.createdAt),
          wallTimeIn(timeZone, order.createdAt),
          order.status,
          fmt(order.completedAt),
          line.name,
          line.qty,
          amount(line.price),
          amount(line.price * line.qty),
          amount(total),
          order.paymentMethod,
          order.notes ?? "",
          order.rejectReason ?? "",
          money.currency,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return [header.join(","), ...rows].join("\n");
}

/**
 * The zone as the CSV's local-time column names it: the IANA name, except
 * India's, which keeps TOE's "IST" so sheets built on "Placed (IST)" keep
 * working. (Engines differ on India's canonical name, hence both.)
 */
export function csvZoneName(timeZone: string): string {
  return timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta"
    ? "IST"
    : timeZone;
}
