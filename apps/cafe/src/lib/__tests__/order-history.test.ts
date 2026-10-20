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

const KOLKATA = "Asia/Kolkata";
const NOW = Date.parse("2026-09-28T09:30:00Z"); // 15:00 on the 28th in India
const at = (iso: string) => Date.parse(iso);

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
  it("covers whole days at the cafe, `to` exclusive", () => {
    // Midnight in India is 18:30 UTC the day before.
    const today = presetRange("today", KOLKATA, NOW);
    expect(today).toEqual({
      from: at("2026-09-27T18:30:00Z"),
      to: at("2026-09-28T18:30:00Z"),
    });
    expect(presetRange("yesterday", KOLKATA, NOW)).toEqual({
      from: at("2026-09-26T18:30:00Z"),
      to: today.from,
    });
    expect(presetRange("last7", KOLKATA, NOW).from).toBe(
      at("2026-09-21T18:30:00Z"),
    );
    expect(presetRange("month", KOLKATA, NOW)).toEqual({
      from: at("2026-08-31T18:30:00Z"),
      to: today.to,
    });
  });

  it("is the cafe's today, whatever zone the device is in", () => {
    // 02:00 UTC on the 28th is still the 27th in New York (22:00 EDT).
    const now = at("2026-09-28T02:00:00Z");
    expect(presetRange("today", "America/New_York", now)).toEqual({
      from: at("2026-09-27T04:00:00Z"),
      to: at("2026-09-28T04:00:00Z"),
    });
    expect(toInputDate(now, "America/New_York")).toBe("2026-09-27");
    expect(toInputDate(now, KOLKATA)).toBe("2026-09-28");
  });

  it("recognises which chip two dates match", () => {
    expect(matchingPreset("2026-09-28", "2026-09-28", KOLKATA, NOW)).toBe(
      "today",
    );
    expect(matchingPreset("2026-09-22", "2026-09-28", KOLKATA, NOW)).toBe(
      "last7",
    );
    expect(matchingPreset("2026-09-01", "2026-09-28", KOLKATA, NOW)).toBe(
      "month",
    );
    expect(matchingPreset("2026-09-02", "2026-09-28", KOLKATA, NOW)).toBeNull();
    // on the 1st, "today" and "this month" are the same dates; the first wins
    const first = at("2026-10-01T03:30:00Z"); // 09:00 IST
    const d = toInputDate(first, KOLKATA);
    expect(matchingPreset(d, d, KOLKATA, first)).toBe("today");
  });
});

describe("inputRange", () => {
  it("makes the end date inclusive", () => {
    const r = inputRange("2026-09-01", "2026-09-01", KOLKATA);
    expect(r).toEqual({
      ok: true,
      days: 1,
      range: {
        from: at("2026-08-31T18:30:00Z"),
        to: at("2026-09-01T18:30:00Z"),
      },
    });
  });

  it("runs midnight to midnight across a daylight-saving change", () => {
    // London's clocks go back on 25 October: that day is 25 hours long.
    expect(inputRange("2026-10-25", "2026-10-25", "Europe/London")).toEqual({
      ok: true,
      days: 1,
      range: {
        from: at("2026-10-24T23:00:00Z"),
        to: at("2026-10-26T00:00:00Z"),
      },
    });
    expect(inputRange("2026-10-01", "2026-10-31", "Europe/London")).toEqual(
      expect.objectContaining({ ok: true, days: 31 }),
    );
  });

  it(`allows ${MAX_RANGE_DAYS} days and refuses more, with a reason`, () => {
    expect(inputRange("2026-08-01", "2026-08-31", KOLKATA).ok).toBe(true);
    const long = inputRange("2026-08-01", "2026-09-01", KOLKATA);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.reason).toMatch(/32 days/);
  });

  it("refuses a backwards or half-empty range", () => {
    expect(inputRange("2026-09-02", "2026-09-01", KOLKATA).ok).toBe(false);
    expect(inputRange("", "2026-09-01", KOLKATA).ok).toBe(false);
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
