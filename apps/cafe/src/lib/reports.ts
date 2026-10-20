/**
 * Report aggregation (docs/requirements.md §4.3 steps 3–4, §5.4).
 *
 * Pure functions over an order list so the maths can be unit-tested and reused
 * by both the dashboard and the CSV export. Everything is whole rupees.
 */

import { orderTotal } from "./money";
import { IST_OFFSET_MS, orderLabel } from "./order-number";
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
  /** YYYY-MM-DD in local time */
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

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

export function dayLabelOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayLabel.format(new Date(y, (m ?? 1) - 1, d ?? 1));
}

/** Local-time month range. `to` is exclusive so month ends don't overlap. */
export function monthRange(year: number, month0: number): Range {
  return {
    from: new Date(year, month0, 1).getTime(),
    to: new Date(year, month0 + 1, 1).getTime(),
  };
}

export function currentMonth(now = Date.now()): {
  year: number;
  month0: number;
} {
  const d = new Date(now);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  // Date handles month overflow, including negative values.
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export function buildReport(orders: Order[], range: Range): Report {
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
    const key = dayKey(order.createdAt);
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
 * working. "Placed (IST)" is the same moment as the cafe's own date and time,
 * "2026-09-28 23:59": the date there is the day an order's number counts in.
 *
 * Rejected orders stay in the export, with "rejected" in the Status column and
 * the staff's reason, so the file is a complete record. Anyone summing it for
 * takings must filter on Status, the way the dashboard does.
 */
/** "YYYY-MM-DD HH:MM" in India time, whatever the device's zone. */
function istDateTime(ms: number): string {
  return new Date(ms + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export function ordersToCsv(orders: Order[]): string {
  const header = [
    "Order #",
    "Order ID",
    "Table",
    "Placed at",
    "Placed (IST)",
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
          istDateTime(order.createdAt),
          order.status,
          fmt(order.completedAt),
          line.name,
          line.qty,
          line.price,
          line.price * line.qty,
          total,
          order.paymentMethod,
          order.notes ?? "",
          order.rejectReason ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return [header.join(","), ...rows].join("\n");
}

export { startOfDay };
