import { describe, expect, it } from "vitest";

import {
  buildReport,
  countsAsSale,
  currentMonth,
  dayKey,
  monthRange,
  ordersToCsv,
  peakDay,
  shiftMonth,
} from "@/lib/reports";
import type { Order } from "@/lib/types";

/** Fixed clock so the tests never depend on the day they run. */
const base = new Date(2026, 2, 15, 10, 30).getTime(); // 15 Mar 2026, local
const hour = 3_600_000;
const day = 24 * hour;

function order(over: Partial<Order> = {}): Order {
  return {
    id: `o-${Math.random()}`,
    orderNumber: 101,
    tableNumber: 1,
    items: [{ menuItemId: "m1", name: "Cappuccino", qty: 1, price: 180 }],
    total: 180,
    status: "completed",
    createdAt: base,
    paymentMethod: "counter",
    ...over,
  };
}

describe("month ranges", () => {
  it("starts on the 1st and ends just before the next month", () => {
    const range = monthRange(2026, 2);
    expect(new Date(range.from).getDate()).toBe(1);
    expect(new Date(range.from).getMonth()).toBe(2);
    expect(new Date(range.to).getMonth()).toBe(3);
    expect(range.to).toBeGreaterThan(range.from);
  });

  it("rolls the year over when stepping forward from December", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
  });

  it("rolls back across the year boundary too", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
  });

  it("reports the current month", () => {
    const { year, month0 } = currentMonth(base);
    expect(year).toBe(2026);
    expect(month0).toBe(2);
  });
});

describe("buildReport", () => {
  const range = monthRange(2026, 2);

  it("handles an empty range without dividing by zero", () => {
    const report = buildReport([], range);
    expect(report.orderCount).toBe(0);
    expect(report.revenue).toBe(0);
    expect(report.averageOrderValue).toBe(0);
    expect(report.topItems).toEqual([]);
    expect(report.byDay).toEqual([]);
  });

  it("excludes orders outside the range", () => {
    const inside = order({ createdAt: base });
    const before = order({ createdAt: base - 40 * day });
    const after = order({ createdAt: range.to + day });
    expect(buildReport([inside, before, after], range).orderCount).toBe(1);
  });

  it("treats the range end as exclusive", () => {
    const onBoundary = order({ createdAt: range.to });
    expect(buildReport([onBoundary], range).orderCount).toBe(0);
  });

  it("reconciles revenue with the sum of the lines", () => {
    const orders = [
      order({
        items: [{ menuItemId: "m1", name: "Cappuccino", qty: 2, price: 180 }],
      }),
      order({
        items: [{ menuItemId: "m2", name: "Scone", qty: 1, price: 160 }],
      }),
    ];
    const report = buildReport(orders, range);
    // totals are recomputed from lines, not trusted from the stored field
    expect(report.revenue).toBe(360 + 160);
    expect(report.orderCount).toBe(2);
  });

  it("computes a rounded average order value", () => {
    const report = buildReport(
      [
        order({ items: [{ menuItemId: "a", name: "A", qty: 1, price: 100 }] }),
        order({ items: [{ menuItemId: "b", name: "B", qty: 1, price: 101 }] }),
        order({ items: [{ menuItemId: "c", name: "C", qty: 1, price: 100 }] }),
      ],
      range,
    );
    expect(report.revenue).toBe(301);
    expect(report.averageOrderValue).toBe(Math.round(301 / 3));
  });

  it("ranks top sellers by revenue and gives shares that sum to 1", () => {
    const report = buildReport(
      [
        order({
          items: [{ menuItemId: "a", name: "Coffee", qty: 1, price: 200 }],
        }),
        order({
          items: [{ menuItemId: "b", name: "Scone", qty: 1, price: 100 }],
        }),
      ],
      range,
    );
    expect(report.topItems[0].name).toBe("Coffee");
    expect(report.topItems[0].qty).toBe(1);
    expect(report.topItems[0].revenue).toBe(200);
    const totalShare = report.topItems.reduce((s, i) => s + i.share, 0);
    expect(totalShare).toBeCloseTo(1, 6);
  });

  it("aggregates the same item across orders", () => {
    const report = buildReport(
      [
        order({
          items: [{ menuItemId: "a", name: "Coffee", qty: 2, price: 100 }],
        }),
        order({
          items: [{ menuItemId: "a", name: "Coffee", qty: 3, price: 100 }],
        }),
      ],
      range,
    );
    expect(report.topItems).toHaveLength(1);
    expect(report.topItems[0].qty).toBe(5);
    expect(report.topItems[0].revenue).toBe(500);
  });

  it("buckets revenue by day in chronological order", () => {
    const report = buildReport(
      [
        order({ createdAt: base + day }),
        order({ createdAt: base }),
        order({ createdAt: base }),
      ],
      range,
    );
    expect(report.byDay).toHaveLength(2);
    expect(report.byDay[0].orders).toBe(2);
    expect(report.byDay[1].orders).toBe(1);
    expect(report.byDay[0].date < report.byDay[1].date).toBe(true);
  });

  it("reports the peak day used to scale the chart", () => {
    const report = buildReport(
      [
        order({ items: [{ menuItemId: "a", name: "A", qty: 1, price: 100 }] }),
        order({
          createdAt: base + day,
          items: [{ menuItemId: "a", name: "A", qty: 3, price: 100 }],
        }),
      ],
      range,
    );
    expect(peakDay(report.byDay)).toBe(300);
  });

  it("counts orders by status", () => {
    const report = buildReport(
      [
        order({ status: "completed" }),
        order({ status: "completed" }),
        order({ status: "preparing" }),
      ],
      range,
    );
    expect(report.statusCounts.completed).toBe(2);
    expect(report.statusCounts.preparing).toBe(1);
  });

  it("leaves orders waiting for the counter out of the takings", () => {
    const report = buildReport(
      [
        order({ status: "completed" }),
        order({ status: "pending", total: 999 }),
        order({ status: "pending", total: 999 }),
        order({ status: "rejected", total: 500 }),
      ],
      range,
    );
    expect(report.orderCount).toBe(1);
    expect(report.revenue).toBe(180);
    expect(report.pendingCount).toBe(2);
    // counted apart: a pending order is not a rejected one
    expect(report.rejectedCount).toBe(1);
    expect(report.byDay.reduce((n, d) => n + d.orders, 0)).toBe(1);
    expect(report.topItems[0].qty).toBe(1);
    expect(report.statusCounts.pending).toBe(2);
    expect(countsAsSale({ status: "pending" })).toBe(false);
    expect(countsAsSale({ status: "preparing" })).toBe(true);
  });

  it("gives each day bucket a dense day-of-month for the chart axis", () => {
    const report = buildReport(
      [order({ createdAt: new Date(2026, 2, 22, 12).getTime() })],
      monthRange(2026, 2),
    );
    // "22 Sept" does not fit under 27 bars; the axis uses 22
    expect(report.byDay[0].dayOfMonth).toBe(22);
    expect(report.byDay[0].label).toMatch(/22/);
  });

  it("keys days in local time", () => {
    expect(dayKey(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });
});

describe("ordersToCsv", () => {
  it("emits a header and one row per order line", () => {
    const csv = ordersToCsv([
      order({
        items: [
          { menuItemId: "a", name: "Coffee", qty: 2, price: 100 },
          { menuItemId: "b", name: "Scone", qty: 1, price: 50 },
        ],
      }),
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Order #");
    expect(lines[0]).toContain("Line total");
  });

  it("escapes commas and quotes so the file opens cleanly", () => {
    const csv = ordersToCsv([
      order({
        items: [
          { menuItemId: "a", name: 'Cheese, chilli "hot"', qty: 1, price: 50 },
        ],
      }),
    ]);
    expect(csv).toContain('"Cheese, chilli ""hot"""');
  });

  it("sorts oldest first", () => {
    const csv = ordersToCsv([
      order({ orderNumber: 2, createdAt: base + hour }),
      order({ orderNumber: 1, createdAt: base }),
    ]);
    const rows = csv.split("\n").slice(1);
    expect(rows[0].startsWith("#1,")).toBe(true);
    expect(rows[1].startsWith("#2,")).toBe(true);
  });

  it("keeps two orders that share a display number apart by their id", () => {
    const csv = ordersToCsv([
      order({ id: "abc123", orderNumber: 417, createdAt: base }),
      order({ id: "xyz789", orderNumber: 417, createdAt: base + hour }),
    ]);
    const [header, ...rows] = csv.split("\n");
    expect(header.split(",").slice(0, 2)).toEqual(["Order #", "Order ID"]);
    expect(rows.map((r) => r.split(",").slice(0, 2))).toEqual([
      ["#417", "abc123"],
      ["#417", "xyz789"],
    ]);
  });

  it("adds the IST date and time next to the UTC one", () => {
    const csv = ordersToCsv([
      order({ id: "late", createdAt: Date.parse("2026-09-28T18:29:00Z") }),
    ]);
    const [header, row] = csv.split("\n");
    const cols = header.split(",");
    const cells = row.split(",");
    expect(cells[cols.indexOf("Placed at")]).toBe("2026-09-28T18:29:00.000Z");
    expect(cells[cols.indexOf("Placed (IST)")]).toBe("2026-09-28 23:59");
  });

  it("prints today's number, zero-padded, ahead of the older one", () => {
    const csv = ordersToCsv([
      order({ id: "a", orderNumber: 417, createdAt: base }),
      order({
        id: "b",
        orderNumber: 417,
        dayNumber: 7,
        dayKey: "2026-09-28",
        createdAt: base + hour,
      }),
    ]);
    const rows = csv.split("\n").slice(1);
    expect(rows[0].split(",")[0]).toBe("#417");
    expect(rows[1].split(",").slice(0, 2)).toEqual(["#0007", "b"]);
  });

  it("produces just a header for no orders", () => {
    expect(ordersToCsv([]).split("\n")).toHaveLength(1);
  });
});
