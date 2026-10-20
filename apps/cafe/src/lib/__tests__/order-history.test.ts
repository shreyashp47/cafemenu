import { describe, expect, it } from "vitest";

import {
  MAX_RANGE_DAYS,
  TERMINAL_STATUSES,
  filterOrders,
  inputRange,
  itemCount,
  matchingPreset,
  presetRange,
  rejectReasonOf,
  tablesIn,
  toInputDate,
} from "@/lib/order-history";
import { ACTIVE_STATUSES, ORDER_STATUSES } from "@/lib/order-status";
import type { Order } from "@/lib/types";

const NOW = new Date(2026, 8, 28, 15, 0).getTime();

function order(over: Partial<Order> = {}): Order {
  return {
    id: `o-${Math.random()}`,
    orderNumber: 417,
    tableNumber: 1,
    items: [{ menuItemId: "m1", name: "Cappuccino", qty: 2, price: 180 }],
    total: 360,
    status: "completed",
    createdAt: NOW,
    paymentMethod: "counter",
    ...over,
  };
}

describe("presetRange", () => {
  it("covers whole local days, `to` exclusive", () => {
    const today = presetRange("today", NOW);
    expect(today.from).toBe(new Date(2026, 8, 28).getTime());
    expect(today.to).toBe(new Date(2026, 8, 29).getTime());
    expect(presetRange("yesterday", NOW)).toEqual({
      from: new Date(2026, 8, 27).getTime(),
      to: today.from,
    });
    expect(presetRange("last7", NOW).from).toBe(
      new Date(2026, 8, 22).getTime(),
    );
    expect(presetRange("month", NOW)).toEqual({
      from: new Date(2026, 8, 1).getTime(),
      to: today.to,
    });
  });

  it("recognises which chip two dates match", () => {
    expect(matchingPreset("2026-09-28", "2026-09-28", NOW)).toBe("today");
    expect(matchingPreset("2026-09-22", "2026-09-28", NOW)).toBe("last7");
    expect(matchingPreset("2026-09-01", "2026-09-28", NOW)).toBe("month");
    expect(matchingPreset("2026-09-02", "2026-09-28", NOW)).toBeNull();
    // on the 1st, "today" and "this month" are the same dates; the first wins
    const first = new Date(2026, 9, 1, 9).getTime();
    const d = toInputDate(first);
    expect(matchingPreset(d, d, first)).toBe("today");
  });
});

describe("inputRange", () => {
  it("makes the end date inclusive", () => {
    const r = inputRange("2026-09-01", "2026-09-01");
    expect(r).toEqual({
      ok: true,
      days: 1,
      range: {
        from: new Date(2026, 8, 1).getTime(),
        to: new Date(2026, 8, 2).getTime(),
      },
    });
  });

  it(`allows ${MAX_RANGE_DAYS} days and refuses more, with a reason`, () => {
    expect(inputRange("2026-08-01", "2026-08-31").ok).toBe(true);
    const long = inputRange("2026-08-01", "2026-09-01");
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.reason).toMatch(/32 days/);
  });

  it("refuses a backwards or half-empty range", () => {
    expect(inputRange("2026-09-02", "2026-09-01").ok).toBe(false);
    expect(inputRange("", "2026-09-01").ok).toBe(false);
  });
});

describe("filterOrders", () => {
  const a = order({ orderNumber: 417, tableNumber: 2, createdAt: NOW - 3 });
  const b = order({
    orderNumber: 120,
    tableNumber: 4,
    status: "preparing",
    createdAt: NOW - 1,
    items: [{ menuItemId: "m2", name: "Masala Chai", qty: 1, price: 60 }],
  });
  const c = order({ orderNumber: 941, tableNumber: 2, createdAt: NOW - 2 });
  const all = [a, b, c];
  const f = (over: object) =>
    filterOrders(all, { status: "all", table: null, search: "", ...over });

  it("sorts newest first", () => {
    expect(f({})).toEqual([b, c, a]);
  });

  it("filters by active, by a terminal status, and by table", () => {
    expect(f({ status: "active" })).toEqual([b]);
    expect(f({ status: "completed" })).toEqual([c, a]);
    expect(f({ table: 2 })).toEqual([c, a]);
    expect(f({ table: 2, status: "active" })).toEqual([]);
  });

  it("searches order numbers with or without #, and item names", () => {
    expect(f({ search: "#417" })).toEqual([a]);
    expect(f({ search: "41" })).toEqual([c, a]);
    expect(f({ search: " chai " })).toEqual([b]);
    expect(f({ search: "CAPPU" })).toEqual([c, a]);
  });
});

describe("helpers", () => {
  it("derives terminal statuses from the status union", () => {
    expect(TERMINAL_STATUSES).toEqual(
      ORDER_STATUSES.filter(
        (s) => !(ACTIVE_STATUSES as readonly string[]).includes(s),
      ),
    );
    expect(TERMINAL_STATUSES).toContain("completed");
  });

  it("counts items and lists tables", () => {
    expect(itemCount(order())).toBe(2);
    expect(
      tablesIn([
        order({ tableNumber: 5 }),
        order({ tableNumber: 2 }),
        order({ tableNumber: 5 }),
      ]),
    ).toEqual([2, 5]);
  });

  it("reads a reject reason only when there is one", () => {
    expect(rejectReasonOf(order())).toBeNull();
    const withReason = { ...order(), rejectReason: "  Duplicate order " };
    expect(rejectReasonOf(withReason as Order)).toBe("Duplicate order");
    const blank = { ...order(), rejectReason: "  " };
    expect(rejectReasonOf(blank as Order)).toBeNull();
  });
});
