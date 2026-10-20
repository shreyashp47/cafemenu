import { describe, expect, it } from "vitest";

import {
  MAX_QTY_PER_LINE,
  cartCount,
  cartTotal,
  clampQty,
  formatElapsed,
  formatINR,
  formatWait,
  lineSubtotal,
  orderTotal,
  priceCart,
  withConsistentTotal,
} from "@/lib/money";
import type { CartLine, MenuItem, Order } from "@/lib/types";

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: "m1",
  name: "Cappuccino",
  description: "",
  price: 180,
  category: "Drinks",
  available: true,
  sortOrder: 10,
  ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  menuItemId: "m1",
  name: "Cappuccino",
  price: 180,
  qty: 1,
  category: "Drinks",
  ...over,
});

describe("money", () => {
  it("multiplies price by quantity", () => {
    expect(lineSubtotal({ price: 180, qty: 2 })).toBe(360);
  });

  it("sums a cart to an exact integer", () => {
    const cart = [
      line({ qty: 2 }),
      line({ menuItemId: "m2", price: 120, qty: 1 }),
    ];
    expect(cartTotal(cart)).toBe(480);
  });

  it("never produces a fractional total from many odd lines", () => {
    const cart = Array.from({ length: 17 }, (_, i) =>
      line({ menuItemId: `m${i}`, price: 55, qty: 3 }),
    );
    const total = cartTotal(cart);
    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(55 * 3 * 17);
  });

  it("counts units, not lines", () => {
    expect(cartCount([line({ qty: 2 }), line({ qty: 3 })])).toBe(5);
  });

  it("clamps quantity into range", () => {
    expect(clampQty(-4)).toBe(0);
    expect(clampQty(0)).toBe(0);
    expect(clampQty(7.4)).toBe(7);
    expect(clampQty(MAX_QTY_PER_LINE + 5)).toBe(MAX_QTY_PER_LINE);
    expect(clampQty(Number.NaN)).toBe(0);
  });

  it("treats a negative or non-finite total as zero in the formatter", () => {
    expect(formatINR(Number.NaN)).toBe(formatINR(0));
    expect(formatINR(Number.POSITIVE_INFINITY)).toBe(formatINR(0));
  });

  it("formats whole rupees with no decimals", () => {
    expect(formatINR(180)).toContain("180");
    expect(formatINR(180)).not.toContain(".");
  });

  it("formats an elapsed time for the staff board", () => {
    expect(formatElapsed(30_000)).toBe("just now");
    expect(formatElapsed(4 * 60_000)).toBe("4m ago");
    expect(formatElapsed(60 * 60_000)).toBe("1h ago");
    expect(formatElapsed(72 * 60_000)).toBe("1h 12m ago");
    expect(formatElapsed(-5)).toBe("0m");
  });

  it("formats the wait timer as mm:ss", () => {
    expect(formatWait(0)).toBe("00:00");
    expect(formatWait(65_000)).toBe("01:05");
    expect(formatWait(600_000)).toBe("10:00");
  });
});

describe("priceCart — authoritative pricing at order time", () => {
  it("accepts a cart that matches the live menu", () => {
    const result = priceCart([line()], [item()]);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(180);
    expect(result.totalChanged).toBe(false);
  });

  it("re-prices against the live menu rather than the cart copy", () => {
    const result = priceCart([line({ price: 150 })], [item({ price: 180 })]);
    expect(result.total).toBe(180);
    expect(result.totalChanged).toBe(true);
    expect(result.changes.join(" ")).toContain("180");
  });

  it("treats a price change as a notice, not a block", () => {
    // blocking here would strand a customer mid-checkout over a few rupees
    const result = priceCart([line({ price: 150 })], [item({ price: 180 })]);
    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it("sorts blocking problems ahead of price changes", () => {
    const result = priceCart(
      [line({ price: 150 }), line({ menuItemId: "gone" })],
      [item({ price: 180 })],
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/no longer on the menu/i);
  });

  it("refuses a sold-out item instead of smuggling it through", () => {
    const result = priceCart([line()], [item({ available: false })]);
    expect(result.ok).toBe(false);
    expect(result.lines).toHaveLength(0);
    expect(result.blocking.join(" ")).toMatch(/sold out/i);
  });

  it("refuses an item that was deleted from the menu", () => {
    const result = priceCart([line()], []);
    expect(result.ok).toBe(false);
    expect(result.blocking.join(" ")).toMatch(/no longer on the menu/i);
  });

  it("keeps the good lines and reports only the bad ones", () => {
    const result = priceCart([line(), line({ menuItemId: "gone" })], [item()]);
    expect(result.ok).toBe(false);
    expect(result.lines).toHaveLength(1);
    expect(result.total).toBe(180);
  });

  it("clamps a tampered quantity", () => {
    const result = priceCart([line({ qty: 9999 })], [item()]);
    expect(result.lines[0].qty).toBe(MAX_QTY_PER_LINE);
  });
});

describe("order total integrity", () => {
  const order: Order = {
    id: "o1",
    orderNumber: 101,
    tableNumber: 3,
    items: [
      { menuItemId: "m1", name: "Cappuccino", qty: 2, price: 180 },
      { menuItemId: "m2", name: "Scone", qty: 1, price: 160 },
    ],
    total: 9999, // deliberately wrong
    status: "preparing",
    createdAt: 1,
    paymentMethod: "counter",
  };

  it("recomputes the order total from its lines", () => {
    expect(orderTotal(order.items)).toBe(520);
  });

  it("repairs a corrupted stored total", () => {
    expect(withConsistentTotal(order).total).toBe(520);
  });

  it("leaves a correct total alone", () => {
    const correct = { ...order, total: 520 };
    expect(withConsistentTotal(correct)).toBe(correct);
  });
});
