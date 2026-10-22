/**
 * Issue #27: the order total is client-supplied, and the rules cannot check it.
 * These pin the free-tier mitigation — the board re-derives the money and flags
 * a tampered order — including the honest case, which must never be flagged.
 */

import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { TicketTotal, TotalWarning } from "@/components/TotalWarning";
import { priceCart } from "@/lib/money";
import { checkOrderIntegrity, summariseIntegrity } from "@/lib/order-integrity";
import { setLiveSettings } from "@/lib/settings";
import type { MenuItem, Order, OrderLine } from "@/lib/types";
import { CURRENCIES, INR, TOE_RUPEES } from "@/test/money";

// Paise, unless a test says otherwise: ₹180 is 18_000.

const menu: MenuItem[] = [
  {
    id: "latte",
    name: "Latte",
    description: "",
    price: 18_000,
    category: "Drinks",
    available: true,
    sortOrder: 1,
  },
  {
    id: "cookie",
    name: "Cookie",
    description: "",
    price: 6_000,
    category: "Sweets",
    available: true,
    sortOrder: 2,
  },
];

const honestLines: OrderLine[] = [
  { menuItemId: "latte", name: "Latte", qty: 2, price: 18_000 },
  { menuItemId: "cookie", name: "Cookie", qty: 1, price: 6_000 },
];

function order(items: OrderLine[], total: number, n = 101): Order {
  return {
    id: `o${n}`,
    orderNumber: n,
    tableNumber: 3,
    items,
    total,
    status: "preparing",
    createdAt: 0,
    paymentMethod: "counter",
  };
}

describe("checkOrderIntegrity", () => {
  it("passes whatever the honest checkout path produces", () => {
    const check = priceCart(
      honestLines.map((l) => ({ ...l, category: "x" })),
      menu,
      INR,
    );
    const result = checkOrderIntegrity(
      order(check.lines, check.total),
      menu,
      INR,
    );
    expect(result).toEqual({
      ok: true,
      storedTotal: 42_000,
      linesTotal: 42_000,
      menuTotal: 42_000,
      issues: [],
    });
  });

  it("flags a doctored total even when the lines are honest", () => {
    const result = checkOrderIntegrity(order(honestLines, 1), menu, INR);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.kind)).toEqual(["total-mismatch"]);
    expect(result.menuTotal).toBe(42_000);
  });

  it("flags doctored line prices even when the total agrees with them", () => {
    const cheap = [{ ...honestLines[0], price: 100 }, honestLines[1]];
    const result = checkOrderIntegrity(order(cheap, 6_200), menu, INR);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.kind)).toEqual(["price-differs"]);
    expect(result.issues[0].message).toMatch(
      /₹1 on the order, ₹180 on the menu/,
    );
    // What to charge: the basket at today's prices.
    expect(result.menuTotal).toBe(42_000);
  });

  it("flags a line that borrows a cheap item's id under a dearer name", () => {
    const swapped = [
      { menuItemId: "cookie", name: "Latte", qty: 1, price: 6_000 },
    ];
    const result = checkOrderIntegrity(order(swapped, 6_000), menu, INR);
    expect(result.issues.map((i) => i.kind)).toEqual(["name-differs"]);
  });

  it("flags an item that is not on the menu, and cannot price the basket", () => {
    const ghost = [
      ...honestLines,
      { menuItemId: "caviar", name: "Caviar", qty: 1, price: 0 },
    ];
    const result = checkOrderIntegrity(order(ghost, 42_000), menu, INR);
    expect(result.issues.map((i) => i.kind)).toEqual(["not-on-menu"]);
    expect(result.menuTotal).toBeNull();
  });

  it("reports a price change since the order as a difference, naming both prices", () => {
    const repriced = menu.map((m) =>
      m.id === "latte" ? { ...m, price: 20_000 } : m,
    );
    const result = checkOrderIntegrity(
      order(honestLines, 42_000),
      repriced,
      INR,
    );
    expect(result.issues).toEqual([
      {
        kind: "price-differs",
        message: "Latte: ₹180 on the order, ₹200 on the menu.",
      },
    ]);
  });

  it("does not flag every line while the menu is still loading", () => {
    const result = checkOrderIntegrity(order(honestLines, 42_000), [], INR);
    expect(result.ok).toBe(true);
    expect(result.menuTotal).toBeNull();
    // but a broken total is still caught without a menu
    expect(checkOrderIntegrity(order(honestLines, 5), [], INR).ok).toBe(false);
  });
});

describe("summariseIntegrity (reports)", () => {
  it("separates a broken total from a mere menu difference", () => {
    const ok = order(honestLines, 42_000, 101);
    const forged = order(honestLines, 10, 102);
    const repriced = order(
      [{ menuItemId: "latte", name: "Latte", qty: 1, price: 15_000 }],
      15_000,
      103,
    );
    const summary = summariseIntegrity([ok, forged, repriced], menu, INR);
    expect(summary.totalMismatch.map((o) => o.orderNumber)).toEqual([102]);
    expect(summary.differsFromMenu.map((o) => o.orderNumber)).toEqual([103]);
  });
});

describe("TotalWarning / TicketTotal", () => {
  it("renders nothing extra for an honest order", () => {
    const check = checkOrderIntegrity(order(honestLines, 42_000), menu, INR);
    const { container } = render(
      createElement("div", null, [
        createElement(TotalWarning, { check, key: "w" }),
        createElement(TicketTotal, { check, key: "t" }),
      ]),
    );
    expect(container.querySelector("[data-integrity]")).toBeNull();
    expect(screen.getByText("₹420")).toBeInTheDocument();
  });

  it("warns before charging and shows what to charge", () => {
    // ₹1 for ₹420 of coffee
    const check = checkOrderIntegrity(order(honestLines, 100), menu, INR);
    render(
      createElement("div", null, [
        createElement(TotalWarning, { check, key: "w" }),
        createElement(TicketTotal, { check, key: "t" }),
      ]),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Total doesn't match menu — check before charging",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "At today's menu prices: ₹420",
    );
    // the stored figure is shown struck through, not as the amount to take
    expect(screen.getByText("₹1").tagName).toBe("S");
  });
});

describe.each(CURRENCIES)("the staff board's total check in $code", (c) => {
  const lattes: MenuItem[] = [{ ...menu[0], price: c.latte }];
  const two = [{ menuItemId: "latte", name: "Latte", qty: 2, price: c.latte }];

  it("passes an honest order", () => {
    const check = checkOrderIntegrity(
      order(two, c.latte * 2),
      lattes,
      c.settings,
    );
    expect(check).toMatchObject({ ok: true, menuTotal: c.latte * 2 });
  });

  it("catches a doctored total, and says so in the cafe's currency", () => {
    const check = checkOrderIntegrity(order(two, c.latte), lattes, c.settings);
    expect(check.menuTotal).toBe(c.latte * 2);
    expect(check.issues).toHaveLength(1);
    expect(check.issues[0].message).toMatch(
      new RegExp(`^Order says ${c.shown.replace(/[$.]/g, "\\$&")}, but`),
    );
  });

  it("catches a doctored line price, naming the menu's", () => {
    const cheap = [{ ...two[0], price: 1 }];
    const check = checkOrderIntegrity(order(cheap, 2), lattes, c.settings);
    expect(check.issues[0].kind).toBe("price-differs");
    expect(check.issues[0].message).toContain(`${c.shown} on the menu`);
  });
});

describe("the staff board's total check on TOE's whole rupees (until #21)", () => {
  it("works on the stored integers as they are", () => {
    const rupees: MenuItem[] = [{ ...menu[0], price: 180 }];
    const two = [{ menuItemId: "latte", name: "Latte", qty: 2, price: 180 }];
    expect(checkOrderIntegrity(order(two, 360), rupees, TOE_RUPEES).ok).toBe(
      true,
    );
    expect(
      checkOrderIntegrity(order(two, 36), rupees, TOE_RUPEES).issues[0].message,
    ).toBe("Order says ₹36, but its items add up to ₹360.");
  });
});

describe("TotalWarning in the cafe's currency", () => {
  it("shows what to charge in yen", () => {
    act(() => setLiveSettings({ currency: "JPY", locale: "ja-JP" }));
    const yen: MenuItem[] = [{ ...menu[0], price: 450 }];
    const two = [{ menuItemId: "latte", name: "Latte", qty: 2, price: 450 }];
    const check = checkOrderIntegrity(
      order(two, 9),
      yen,
      CURRENCIES[2].settings,
    );
    render(createElement(TotalWarning, { check }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "At today's menu prices: ￥900",
    );
  });
});
