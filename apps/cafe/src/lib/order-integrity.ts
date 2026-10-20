/**
 * Does an order's money add up? (issue #27)
 *
 * An order's `total`, and the unit `price` on each line, are written by the
 * customer's phone. `priceCart()` makes the honest phone get them right, but
 * the rules cannot recompute either (no loops, no lambdas), so a customer with
 * devtools can post a real basket at a made-up price and Firestore accepts it.
 * The real fix is a trusted backend, which needs the Blaze plan; see
 * docs/decisions.md.
 *
 * This is the free-tier half: **detection, not prevention**. The staff board
 * re-derives every order from the stored lines and the live menu and flags the
 * ones that do not match, so a tampered order is caught at the counter — where
 * the money actually changes hands — instead of going unnoticed.
 *
 * What is compared, and why:
 *
 *  - `total` against the sum of the stored lines. The honest client always
 *    writes exactly that sum, so a mismatch has no innocent explanation.
 *  - each line's unit price, and name, against the menu item it points at.
 *    Lines store the price *at order time* on purpose, so history never
 *    re-prices. That means an owner editing a price after an order was placed
 *    also shows up here. On the live board that window is minutes, so the
 *    message names both prices and lets the barista judge; for months-old
 *    orders in the reports it is only a hint, and is worded as one.
 *  - a line whose item is not on the menu at all. Deleted since, or invented.
 *
 * The figure to charge is `menuTotal`: what the basket costs at today's menu.
 */

import { formatINR, orderTotal } from "./money";
import type { MenuItem, Order } from "./types";

export type IntegrityIssueKind =
  "total-mismatch" | "price-differs" | "name-differs" | "not-on-menu";

export interface IntegrityIssue {
  kind: IntegrityIssueKind;
  message: string;
}

export interface IntegrityCheck {
  /** True when nothing below needs a human to look. */
  ok: boolean;
  /** The total written on the order. */
  storedTotal: number;
  /** Sum of the stored lines at their stored prices. */
  linesTotal: number;
  /**
   * The basket re-priced at the current menu, or null when it cannot be (the
   * menu has not loaded, or a line's item is not on it).
   */
  menuTotal: number | null;
  issues: IntegrityIssue[];
}

/**
 * `menu` may be empty while it is still loading; the menu checks are then
 * skipped rather than flagging every line as "not on the menu".
 */
export function checkOrderIntegrity(
  order: Pick<Order, "items" | "total">,
  menu: readonly MenuItem[],
): IntegrityCheck {
  const issues: IntegrityIssue[] = [];
  const linesTotal = orderTotal(order.items);

  if (linesTotal !== order.total) {
    issues.push({
      kind: "total-mismatch",
      message: `Order says ${formatINR(order.total)}, but its items add up to ${formatINR(linesTotal)}.`,
    });
  }

  let menuTotal: number | null = null;
  if (menu.length > 0) {
    const byId = new Map(menu.map((item) => [item.id, item]));
    let sum = 0;
    let priceable = true;

    for (const line of order.items) {
      const item = byId.get(line.menuItemId);
      if (!item) {
        priceable = false;
        issues.push({
          kind: "not-on-menu",
          message: `${line.name} is not on the menu.`,
        });
        continue;
      }
      sum += Math.round(item.price) * Math.max(0, Math.round(line.qty));
      if (item.price !== line.price) {
        issues.push({
          kind: "price-differs",
          message: `${line.name}: ${formatINR(line.price)} on the order, ${formatINR(item.price)} on the menu.`,
        });
      }
      if (item.name.trim().toLowerCase() !== line.name.trim().toLowerCase()) {
        issues.push({
          kind: "name-differs",
          message: `"${line.name}" is priced as ${item.name}.`,
        });
      }
    }
    if (priceable) menuTotal = sum;
  }

  return {
    ok: issues.length === 0,
    storedTotal: order.total,
    linesTotal,
    menuTotal,
    issues,
  };
}

/**
 * Report-level summary. Only the self-consistency check is meaningful for old
 * orders — menu prices move — so that is the one counted as a problem; the
 * menu differences are counted separately and described as a hint.
 */
export function summariseIntegrity(
  orders: readonly Order[],
  menu: readonly MenuItem[],
): {
  totalMismatch: Order[];
  differsFromMenu: Order[];
} {
  const totalMismatch: Order[] = [];
  const differsFromMenu: Order[] = [];
  for (const order of orders) {
    const check = checkOrderIntegrity(order, menu);
    if (check.issues.some((i) => i.kind === "total-mismatch")) {
      totalMismatch.push(order);
    } else if (!check.ok) {
      differsFromMenu.push(order);
    }
  }
  return { totalMismatch, differsFromMenu };
}
