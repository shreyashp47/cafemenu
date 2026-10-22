import { describe, expect, it } from "vitest";

import {
  MAX_QTY_PER_LINE,
  cartCount,
  cartTotal,
  clampQty,
  formatElapsed,
  formatMoney,
  formatWait,
  lineSubtotal,
  orderTotal,
  priceCart,
  withConsistentTotal,
} from "@/lib/money";
import type { CartLine, MenuItem, Order } from "@/lib/types";
import { CURRENCIES, INR, TOE_RUPEES } from "@/test/money";

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: "m1",
  name: "Cappuccino",
  description: "",
  price: 18_000,
  category: "Drinks",
  available: true,
  sortOrder: 10,
  ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  menuItemId: "m1",
  name: "Cappuccino",
  price: 18_000,
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
      line({ menuItemId: "m2", price: 12_000, qty: 1 }),
    ];
    expect(cartTotal(cart)).toBe(48_000);
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

  it("treats a non-finite total as zero in the formatter", () => {
    expect(formatMoney(Number.NaN, INR)).toBe(formatMoney(0, INR));
    expect(formatMoney(Number.POSITIVE_INFINITY, INR)).toBe("₹0");
  });

  it("formats paise as rupees, decimals only when there are some", () => {
    expect(formatMoney(18_000, INR)).toBe("₹180");
    expect(formatMoney(18_050, INR)).toBe("₹180.50");
  });

  it("formats TOE's whole rupees as it always did", () => {
    expect(formatMoney(180, TOE_RUPEES)).toBe("₹180");
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
    const result = priceCart([line()], [item()], INR);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(18_000);
    expect(result.totalChanged).toBe(false);
  });

  it("re-prices against the live menu rather than the cart copy", () => {
    const result = priceCart(
      [line({ price: 15_000 })],
      [item({ price: 18_000 })],
      INR,
    );
    expect(result.total).toBe(18_000);
    expect(result.totalChanged).toBe(true);
    expect(result.changes).toEqual(["Cappuccino is now ₹180."]);
  });

  it("treats a price change as a notice, not a block", () => {
    // blocking here would strand a customer mid-checkout over a few rupees
    const result = priceCart(
      [line({ price: 15_000 })],
      [item({ price: 18_000 })],
      INR,
    );
    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it("sorts blocking problems ahead of price changes", () => {
    const result = priceCart(
      [line({ price: 15_000 }), line({ menuItemId: "gone" })],
      [item({ price: 18_000 })],
      INR,
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/no longer on the menu/i);
  });

  it("refuses a sold-out item instead of smuggling it through", () => {
    const result = priceCart([line()], [item({ available: false })], INR);
    expect(result.ok).toBe(false);
    expect(result.lines).toHaveLength(0);
    expect(result.blocking.join(" ")).toMatch(/sold out/i);
  });

  it("refuses an item that was deleted from the menu", () => {
    const result = priceCart([line()], [], INR);
    expect(result.ok).toBe(false);
    expect(result.blocking.join(" ")).toMatch(/no longer on the menu/i);
  });

  it("keeps the good lines and reports only the bad ones", () => {
    const result = priceCart(
      [line(), line({ menuItemId: "gone" })],
      [item()],
      INR,
    );
    expect(result.ok).toBe(false);
    expect(result.lines).toHaveLength(1);
    expect(result.total).toBe(18_000);
  });

  it("clamps a tampered quantity", () => {
    const result = priceCart([line({ qty: 9999 })], [item()], INR);
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

describe.each(CURRENCIES)("menu, cart and order in $code", (c) => {
  const latte = (over: Partial<CartLine> = {}) =>
    line({ name: "Latte", price: c.latte, ...over });

  it("shows a menu price in the cafe's currency", () => {
    expect(formatMoney(item({ price: c.latte }).price, c.settings)).toBe(
      c.shown,
    );
  });

  it("adds a cart and an order up exactly, in the stored unit", () => {
    const cart = [latte({ qty: 3 }), latte({ menuItemId: "m2", qty: 1 })];
    expect(cartTotal(cart)).toBe(c.latte * 4);
    const check = priceCart(
      cart,
      [item({ price: c.latte }), item({ id: "m2", price: c.latte })],
      c.settings,
    );
    expect(check.total).toBe(c.latte * 4);
    expect(orderTotal(check.lines)).toBe(c.latte * 4);
    expect(Number.isInteger(check.total)).toBe(true);
  });

  it("tells the customer a new price in the cafe's currency", () => {
    const check = priceCart(
      [latte({ price: c.latte - 1 })],
      [item({ name: "Latte", price: c.latte })],
      c.settings,
    );
    expect(check.changes).toEqual([`Latte is now ${c.shown}.`]);
  });
});
