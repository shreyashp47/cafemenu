/**
 * Issue #27: the order total is client-supplied, and the rules cannot check it.
 * These pin the free-tier mitigation — the board re-derives the money and flags
 * a tampered order — including the honest case, which must never be flagged.
 */

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { TicketTotal, TotalWarning } from "@/components/TotalWarning";
import { priceCart } from "@/lib/money";
import { checkOrderIntegrity, summariseIntegrity } from "@/lib/order-integrity";
import type { MenuItem, Order, OrderLine } from "@/lib/types";

const menu: MenuItem[] = [
  {
    id: "latte",
    name: "Latte",
    description: "",
    price: 180,
    category: "Drinks",
    available: true,
    sortOrder: 1,
  },
  {
    id: "cookie",
    name: "Cookie",
    description: "",
    price: 60,
    category: "Sweets",
    available: true,
    sortOrder: 2,
  },
];

const honestLines: OrderLine[] = [
  { menuItemId: "latte", name: "Latte", qty: 2, price: 180 },
  { menuItemId: "cookie", name: "Cookie", qty: 1, price: 60 },
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
    );
    const result = checkOrderIntegrity(order(check.lines, check.total), menu);
    expect(result).toEqual({
      ok: true,
      storedTotal: 420,
      linesTotal: 420,
      menuTotal: 420,
      issues: [],
    });
  });

  it("flags a doctored total even when the lines are honest", () => {
    const result = checkOrderIntegrity(order(honestLines, 1), menu);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.kind)).toEqual(["total-mismatch"]);
    expect(result.menuTotal).toBe(420);
  });

  it("flags doctored line prices even when the total agrees with them", () => {
    const cheap = [{ ...honestLines[0], price: 1 }, honestLines[1]];
    const result = checkOrderIntegrity(order(cheap, 62), menu);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.kind)).toEqual(["price-differs"]);
    expect(result.issues[0].message).toMatch(
      /₹1 on the order, ₹180 on the menu/,
    );
    // What to charge: the basket at today's prices.
    expect(result.menuTotal).toBe(420);
  });

  it("flags a line that borrows a cheap item's id under a dearer name", () => {
    const swapped = [
      { menuItemId: "cookie", name: "Latte", qty: 1, price: 60 },
    ];
    const result = checkOrderIntegrity(order(swapped, 60), menu);
    expect(result.issues.map((i) => i.kind)).toEqual(["name-differs"]);
  });

  it("flags an item that is not on the menu, and cannot price the basket", () => {
    const ghost = [
      ...honestLines,
      { menuItemId: "caviar", name: "Caviar", qty: 1, price: 0 },
    ];
    const result = checkOrderIntegrity(order(ghost, 420), menu);
    expect(result.issues.map((i) => i.kind)).toEqual(["not-on-menu"]);
    expect(result.menuTotal).toBeNull();
  });

  it("reports a price change since the order as a difference, naming both prices", () => {
    const repriced = menu.map((m) =>
      m.id === "latte" ? { ...m, price: 200 } : m,
    );
    const result = checkOrderIntegrity(order(honestLines, 420), repriced);
    expect(result.issues).toEqual([
      {
        kind: "price-differs",
        message: "Latte: ₹180 on the order, ₹200 on the menu.",
      },
    ]);
  });

  it("does not flag every line while the menu is still loading", () => {
    const result = checkOrderIntegrity(order(honestLines, 420), []);
    expect(result.ok).toBe(true);
    expect(result.menuTotal).toBeNull();
    // but a broken total is still caught without a menu
    expect(checkOrderIntegrity(order(honestLines, 5), []).ok).toBe(false);
  });
});

describe("summariseIntegrity (reports)", () => {
  it("separates a broken total from a mere menu difference", () => {
    const ok = order(honestLines, 420, 101);
    const forged = order(honestLines, 10, 102);
    const repriced = order(
      [{ menuItemId: "latte", name: "Latte", qty: 1, price: 150 }],
      150,
      103,
    );
    const summary = summariseIntegrity([ok, forged, repriced], menu);
    expect(summary.totalMismatch.map((o) => o.orderNumber)).toEqual([102]);
    expect(summary.differsFromMenu.map((o) => o.orderNumber)).toEqual([103]);
  });
});

describe("TotalWarning / TicketTotal", () => {
  it("renders nothing extra for an honest order", () => {
    const check = checkOrderIntegrity(order(honestLines, 420), menu);
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
    const check = checkOrderIntegrity(order(honestLines, 1), menu);
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
