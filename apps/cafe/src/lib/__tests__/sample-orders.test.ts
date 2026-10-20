/**
 * The sample-month seeder, and the report it produces.
 *
 * This generator exists so the reports screen can be evaluated with realistic
 * data. If it produced a month that broke `buildReport`, the demo would quietly
 * misrepresent the thing it is demonstrating — so the two are tested together.
 */

import { describe, expect, it } from "vitest";

import { buildSampleOrders } from "@/lib/data/sample-orders";
import {
  demoSeedOrders,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { orderTotal } from "@/lib/money";
import { displayNumberFromId } from "@/lib/order-number";
import { buildReport, currentMonth, monthRange } from "@/lib/reports";
import { demoOrderRepo } from "@/lib/data/demo";
import type { Order } from "@/lib/types";

// The demo cafe's zone, which buildSampleOrders defaults to.
const KOLKATA = "Asia/Kolkata";
// A fixed "now" so the generated month is deterministic in shape.
const NOW = Date.parse("2026-06-18T09:30:00Z"); // 18 Jun 2026, 15:00 in India

describe("buildSampleOrders", () => {
  const orders = buildSampleOrders(120, NOW);

  it("generates the requested count", () => {
    expect(orders).toHaveLength(120);
  });

  it("stays inside the month containing now", () => {
    const range = monthRange(2026, 5, KOLKATA);
    for (const order of orders) {
      expect(order.createdAt).toBeGreaterThanOrEqual(range.from);
      expect(order.createdAt).toBeLessThanOrEqual(NOW);
    }
  });

  it("never claims an order is from the future", () => {
    expect(orders.some((o) => o.createdAt > NOW)).toBe(false);
  });

  it("uses only menu items that exist and priced lines consistently", () => {
    for (const order of orders) {
      expect(order.items.length).toBeGreaterThan(0);
      for (const line of order.items) {
        expect(line.name).toBeTruthy();
        expect(line.price).toBeGreaterThanOrEqual(0);
        expect(line.qty).toBeGreaterThan(0);
      }
    }
  });

  it("totals every order from its own lines", () => {
    for (const order of orders) {
      expect(order.total).toBe(orderTotal(order.items));
    }
  });

  it("only stamps completedAt on completed orders", () => {
    for (const order of orders) {
      if (order.status === "completed") {
        expect(order.completedAt).toBeGreaterThanOrEqual(order.createdAt);
      } else {
        expect(order.completedAt).toBeUndefined();
      }
    }
  });

  it("uses only valid table numbers", () => {
    for (const order of orders) {
      expect(order.tableNumber).toBeGreaterThanOrEqual(1);
      expect(order.tableNumber).toBeLessThanOrEqual(6);
    }
  });

  it("returns them in chronological order", () => {
    for (let i = 1; i < orders.length; i += 1) {
      expect(orders[i].createdAt).toBeGreaterThanOrEqual(
        orders[i - 1].createdAt,
      );
    }
  });

  it("includes every status, so the board and the timeline are realistic", () => {
    // Runs this 20x: the generator is seeded by Math.random(), and an earlier
    // random-pick version left "preparing" absent ~6% of the time, which is a
    // flake in CI and an empty-looking demo board.
    for (let run = 0; run < 20; run += 1) {
      const statuses = new Set(
        buildSampleOrders(120, NOW).map((o) => o.status),
      );
      for (const expected of [
        "completed",
        "served",
        "ready",
        "preparing",
      ] as const) {
        expect(statuses.has(expected)).toBe(true);
      }
    }
  });

  it("always leaves at least a few orders open on the staff board", () => {
    for (const count of [40, 120, 240]) {
      const open = buildSampleOrders(count, NOW).filter(
        (o) => o.status !== "completed",
      );
      expect(open.length).toBeGreaterThanOrEqual(4);
      expect(open.length).toBeLessThan(count * 0.2);
    }
  });
});

describe("a seeded demo month reports sensibly", () => {
  it("produces revenue, orders and a best-seller list", () => {
    resetDemoStore();
    const seeded = demoSeedOrders(buildSampleOrders(200, NOW), KOLKATA);
    expect(seeded).toBe(200);

    const stored = loadDemoState().orders;
    const range = monthRange(
      currentMonth(KOLKATA, NOW).year,
      currentMonth(KOLKATA, NOW).month0,
      KOLKATA,
    );
    const report = buildReport(stored, range, KOLKATA);

    expect(report.orderCount).toBe(200);
    expect(report.revenue).toBe(
      stored.reduce((sum, o) => sum + orderTotal(o.items), 0),
    );
    expect(report.averageOrderValue).toBeGreaterThan(0);
    expect(report.topItems.length).toBeGreaterThan(1);
    expect(report.topItems[0].revenue).toBeGreaterThanOrEqual(
      report.topItems[1]?.revenue ?? 0,
    );
    expect(report.byDay.length).toBeGreaterThan(5);
    expect(report.statusCounts.completed).toBeGreaterThan(0);
  });

  it("is visible on the staff board as active orders", async () => {
    resetDemoStore();
    demoSeedOrders(buildSampleOrders(200, NOW), KOLKATA);
    const active = await demoOrderRepo.listRange(0, Date.now() + 1000);
    const open = active.filter((o: Order) => o.status !== "completed");
    expect(open.length).toBeGreaterThan(0);
    expect(open.length).toBeLessThan(active.length);
  });

  it("gives every order a unique id and the number derived from it", () => {
    resetDemoStore();
    demoSeedOrders(buildSampleOrders(60, NOW), KOLKATA);
    const { orders } = loadDemoState();
    expect(new Set(orders.map((o) => o.id)).size).toBe(orders.length);
    for (const o of orders) {
      expect(o.orderNumber).toBe(displayNumberFromId(o.id));
    }
  });
});
