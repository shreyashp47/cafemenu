import { describe, expect, it } from "vitest";

import {
  buildReport,
  countsAsSale,
  csvZoneName,
  currentMonth,
  monthRange,
  ordersToCsv,
  peakDay,
  shiftMonth,
} from "@/lib/reports";
import type { Order } from "@/lib/types";
import { CURRENCIES, INR, TOE_RUPEES } from "@/test/money";

const KOLKATA = "Asia/Kolkata";
const LONDON = "Europe/London";
const at = (iso: string) => Date.parse(iso);

/** Fixed clock so the tests never depend on the day they run. */
const base = at("2026-03-15T05:00:00Z"); // 15 Mar 2026, 10:30 in India
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
  it("runs from the cafe's midnight on the 1st to the next month's", () => {
    expect(monthRange(2026, 2, KOLKATA)).toEqual({
      from: at("2026-02-28T18:30:00Z"),
      to: at("2026-03-31T18:30:00Z"),
    });
    // London's clocks go forward on 29 March: the month is an hour short.
    expect(monthRange(2026, 2, LONDON)).toEqual({
      from: at("2026-03-01T00:00:00Z"),
      to: at("2026-03-31T23:00:00Z"),
    });
    expect(monthRange(2026, 11, LONDON).to).toBe(at("2027-01-01T00:00:00Z"));
  });

  it("rolls the year over when stepping forward from December", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
  });

  it("rolls back across the year boundary too", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
  });

  it("reports the current month", () => {
    const { year, month0 } = currentMonth(KOLKATA, base);
    expect(year).toBe(2026);
    expect(month0).toBe(2);
  });

  it("is the cafe's month, which can be ahead of the device's", () => {
    // 20:00 UTC on 31 March is already 1 April in India, still March in London.
    const now = at("2026-03-31T20:00:00Z");
    expect(currentMonth(KOLKATA, now)).toEqual({ year: 2026, month0: 3 });
    expect(currentMonth(LONDON, now)).toEqual({ year: 2026, month0: 2 });
    expect(
      currentMonth("Pacific/Auckland", at("2026-12-31T11:00:00Z")),
    ).toEqual({ year: 2027, month0: 0 });
  });
});

describe("buildReport", () => {
  const range = monthRange(2026, 2, KOLKATA);

  it("handles an empty range without dividing by zero", () => {
    const report = buildReport([], range, KOLKATA);
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
    expect(
      buildReport([inside, before, after], range, KOLKATA).orderCount,
    ).toBe(1);
  });

  it("treats the range end as exclusive", () => {
    const onBoundary = order({ createdAt: range.to });
    expect(buildReport([onBoundary], range, KOLKATA).orderCount).toBe(0);
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
    const report = buildReport(orders, range, KOLKATA);
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
      KOLKATA,
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
      KOLKATA,
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
      KOLKATA,
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
      KOLKATA,
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
      KOLKATA,
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
      KOLKATA,
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
      KOLKATA,
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
      [order({ createdAt: at("2026-03-22T06:30:00Z") })],
      monthRange(2026, 2, KOLKATA),
      KOLKATA,
    );
    // "22 Sept" does not fit under 27 bars; the axis uses 22
    expect(report.byDay[0].dayOfMonth).toBe(22);
    expect(report.byDay[0].label).toMatch(/22/);
  });

  it("buckets by the cafe's day, not the device's or UTC's", () => {
    // 20:00 UTC on the 15th is 01:30 on the 16th in India, 20:00 in London.
    const late = order({ createdAt: at("2026-03-15T20:00:00Z") });
    const range = { from: at("2026-03-01"), to: at("2026-04-01") };
    expect(buildReport([late], range, KOLKATA).byDay[0].date).toBe(
      "2026-03-16",
    );
    expect(buildReport([late], range, LONDON).byDay[0].date).toBe("2026-03-15");
  });

  it("splits days at the cafe's midnight on a daylight-saving change day", () => {
    // New York springs forward on 8 March: the 9th starts at 04:00 UTC,
    // where the 8th started at 05:00.
    const report = buildReport(
      [
        order({ createdAt: at("2026-03-08T04:59:59Z") }), // 23:59:59, 7th
        order({ createdAt: at("2026-03-08T05:00:00Z") }), // 00:00, 8th
        order({ createdAt: at("2026-03-09T03:59:59Z") }), // 23:59:59, 8th
        order({ createdAt: at("2026-03-09T04:00:00Z") }), // 00:00, 9th
      ],
      { from: at("2026-03-01"), to: at("2026-04-01") },
      "America/New_York",
    );
    expect(report.byDay.map((d) => [d.date, d.orders])).toEqual([
      ["2026-03-07", 1],
      ["2026-03-08", 2],
      ["2026-03-09", 1],
    ]);
    expect(report.byDay.map((d) => d.label)).toEqual([
      "7 Mar",
      "8 Mar",
      "9 Mar",
    ]);
  });
});

describe("ordersToCsv", () => {
  it("emits a header and one row per order line", () => {
    const csv = ordersToCsv(
      [
        order({
          items: [
            { menuItemId: "a", name: "Coffee", qty: 2, price: 100 },
            { menuItemId: "b", name: "Scone", qty: 1, price: 50 },
          ],
        }),
      ],
      KOLKATA,
      INR,
    );
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Order #");
    expect(lines[0]).toContain("Line total");
  });

  it("escapes commas and quotes so the file opens cleanly", () => {
    const csv = ordersToCsv(
      [
        order({
          items: [
            {
              menuItemId: "a",
              name: 'Cheese, chilli "hot"',
              qty: 1,
              price: 50,
            },
          ],
        }),
      ],
      KOLKATA,
      INR,
    );
    expect(csv).toContain('"Cheese, chilli ""hot"""');
  });

  it("sorts oldest first", () => {
    const csv = ordersToCsv(
      [
        order({ orderNumber: 2, createdAt: base + hour }),
        order({ orderNumber: 1, createdAt: base }),
      ],
      KOLKATA,
      INR,
    );
    const rows = csv.split("\n").slice(1);
    expect(rows[0].startsWith("#1,")).toBe(true);
    expect(rows[1].startsWith("#2,")).toBe(true);
  });

  it("keeps two orders that share a display number apart by their id", () => {
    const csv = ordersToCsv(
      [
        order({ id: "abc123", orderNumber: 417, createdAt: base }),
        order({ id: "xyz789", orderNumber: 417, createdAt: base + hour }),
      ],
      KOLKATA,
      INR,
    );
    const [header, ...rows] = csv.split("\n");
    expect(header.split(",").slice(0, 2)).toEqual(["Order #", "Order ID"]);
    expect(rows.map((r) => r.split(",").slice(0, 2))).toEqual([
      ["#417", "abc123"],
      ["#417", "xyz789"],
    ]);
  });

  it("adds India's date and time next to the UTC one, as TOE's IST column", () => {
    const csv = ordersToCsv(
      [order({ id: "late", createdAt: Date.parse("2026-09-28T18:29:00Z") })],
      KOLKATA,
      INR,
    );
    const [header, row] = csv.split("\n");
    const cols = header.split(",");
    const cells = row.split(",");
    expect(cells[cols.indexOf("Placed at")]).toBe("2026-09-28T18:29:00.000Z");
    expect(cells[cols.indexOf("Placed (IST)")]).toBe("2026-09-28 23:59");
  });

  it("names any other zone in the column, and gives its own clock", () => {
    const csv = ordersToCsv(
      [
        // The clocks go back at 02:00 BST on 25 October, so 01:30 happens
        // twice; "Placed at" (UTC) tells the two apart.
        order({ id: "bst", createdAt: at("2026-10-25T00:30:00Z") }),
        order({ id: "gmt", createdAt: at("2026-10-25T01:30:00Z") }),
      ],
      LONDON,
      INR,
    );
    const [header, ...rows] = csv.split("\n");
    const cols = header.split(",");
    expect(cols).toContain("Placed (Europe/London)");
    expect(cols).not.toContain("Placed (IST)");
    const local = cols.indexOf("Placed (Europe/London)");
    const utc = cols.indexOf("Placed at");
    expect(rows.map((r) => [r.split(",")[utc], r.split(",")[local]])).toEqual([
      ["2026-10-25T00:30:00.000Z", "2026-10-25 01:30"],
      ["2026-10-25T01:30:00.000Z", "2026-10-25 01:30"],
    ]);
  });

  it("keeps TOE's IST heading for India under either of its names", () => {
    expect(csvZoneName("Asia/Kolkata")).toBe("IST");
    expect(csvZoneName("Asia/Calcutta")).toBe("IST");
    expect(csvZoneName("Asia/Kathmandu")).toBe("Asia/Kathmandu");
  });

  it("prints today's number, zero-padded, ahead of the older one", () => {
    const csv = ordersToCsv(
      [
        order({ id: "a", orderNumber: 417, createdAt: base }),
        order({
          id: "b",
          orderNumber: 417,
          dayNumber: 7,
          dayKey: "2026-09-28",
          createdAt: base + hour,
        }),
      ],
      KOLKATA,
      INR,
    );
    const rows = csv.split("\n").slice(1);
    expect(rows[0].split(",")[0]).toBe("#417");
    expect(rows[1].split(",").slice(0, 2)).toEqual(["#0007", "b"]);
  });

  it("produces just a header for no orders", () => {
    expect(ordersToCsv([], KOLKATA, INR).split("\n")).toHaveLength(1);
  });
});

describe("ordersToCsv: amounts in the cafe's currency", () => {
  it.each([
    ["INR in paise", INR, 18_050, "180.50", "361.00"],
    ["USD in cents", CURRENCIES[1].settings, 450, "4.50", "9.00"],
    ["JPY", CURRENCIES[2].settings, 450, "450", "900"],
    ["TOE's whole rupees", TOE_RUPEES, 180, "180", "360"],
  ])(
    "%s: plain decimals, and the currency named",
    (_, money, price, unit, sum) => {
      const csv = ordersToCsv(
        [
          order({
            items: [{ menuItemId: "l", name: "Latte", qty: 2, price }],
            total: price * 2,
          }),
        ],
        KOLKATA,
        money,
      );
      const [header, row] = csv.split("\n");
      const cols = header.split(",");
      const cells = row.split(",");
      expect(cells[cols.indexOf("Unit price")]).toBe(unit);
      expect(cells[cols.indexOf("Line total")]).toBe(sum);
      expect(cells[cols.indexOf("Order total")]).toBe(sum);
      expect(cells[cols.indexOf("Currency")]).toBe(money.currency);
      expect(cols.at(-1)).toBe("Currency");
    },
  );

  it("adds up the items, not a doctored total, in the cafe's unit", () => {
    const csv = ordersToCsv(
      [
        order({
          items: [{ menuItemId: "l", name: "Latte", qty: 2, price: 450 }],
          total: 1,
        }),
      ],
      KOLKATA,
      CURRENCIES[1].settings,
    );
    const [header, row] = csv.split("\n");
    expect(row.split(",")[header.split(",").indexOf("Order total")]).toBe(
      "9.00",
    );
  });
});

describe.each(CURRENCIES)("buildReport in $code", (c) => {
  const range = { from: base - day, to: base + day };

  it("sums revenue in the stored unit, and averages to a whole one", () => {
    const report = buildReport(
      [
        order({
          items: [{ menuItemId: "l", name: "Latte", qty: 1, price: c.latte }],
        }),
        order({
          items: [
            { menuItemId: "l", name: "Latte", qty: 1, price: c.latte + 1 },
          ],
        }),
      ],
      range,
      KOLKATA,
    );
    expect(report.revenue).toBe(c.latte * 2 + 1);
    expect(Number.isInteger(report.averageOrderValue)).toBe(true);
    expect(report.averageOrderValue).toBe(c.latte + 1);
    expect(report.topItems[0]).toMatchObject({ name: "Latte", qty: 2 });
  });
});
