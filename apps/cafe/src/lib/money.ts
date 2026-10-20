/**
 * Money + order maths. Every calculation the app and the reports rely on lives
 * here so it can be unit-tested without a browser (see src/lib/__tests__).
 *
 * Prices are whole rupees (integers). Totals are computed from integers, never
 * by summing floats, so a cart can never show 99.999999999 rupees.
 */

import type { CartLine, MenuItem, Order, OrderLine } from "./types";

/** Per-line subtotal, in rupees. */
export function lineSubtotal(line: Pick<OrderLine, "price" | "qty">): number {
  return Math.round(line.price) * Math.max(0, Math.round(line.qty));
}

/** Cart total, in rupees. */
export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + Math.max(0, line.qty), 0);
}

/** Quantity of a specific item in the cart. */
export function qtyOf(lines: CartLine[], menuItemId: string): number {
  return lines.find((l) => l.menuItemId === menuItemId)?.qty ?? 0;
}

/** Upper bound on a single line, so one stray tap can't order 99 coffees. */
export const MAX_QTY_PER_LINE = 20;

export function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.min(MAX_QTY_PER_LINE, Math.max(0, Math.round(qty)));
}

/**
 * Authoritative pricing.
 *
 * A cart line carries a price copied from the menu at the time it was added, so
 * an owner editing a price mid-session can't silently change what a customer
 * already picked up. But a *newly placed* order must be re-priced against the
 * live menu so the cafe never charges a stale amount.
 *
 * Problems come in two severities:
 *   - `blocking`: the item was deleted or sold out. The order cannot be placed.
 *   - `changes`: only the price moved. The customer has already seen the fresh
 *     total (the CTA always renders `check.total`), so this is informational —
 *     blocking here would strand a customer mid-checkout over a few rupees.
 */
export interface PriceCheck {
  ok: boolean;
  lines: OrderLine[];
  total: number;
  totalChanged: boolean;
  /** Everything worth telling the customer, blocking first. */
  problems: string[];
  blocking: string[];
  changes: string[];
}

export function priceCart(lines: CartLine[], menu: MenuItem[]): PriceCheck {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const out: OrderLine[] = [];
  const blocking: string[] = [];
  const changes: string[] = [];
  let stale = false;

  for (const line of lines) {
    const item = byId.get(line.menuItemId);
    if (!item) {
      blocking.push(`${line.name} is no longer on the menu.`);
      continue;
    }
    if (!item.available) {
      blocking.push(`${line.name} just sold out.`);
      continue;
    }
    if (item.price !== line.price) {
      stale = true;
      changes.push(`${line.name} is now ${formatINR(item.price)}.`);
    }
    out.push({
      menuItemId: item.id,
      name: item.name,
      qty: clampQty(line.qty),
      price: item.price,
    });
  }

  return {
    ok: blocking.length === 0,
    lines: out,
    total: out.reduce((sum, l) => sum + lineSubtotal(l), 0),
    totalChanged: stale,
    problems: [...blocking, ...changes],
    blocking,
    changes,
  };
}

export function orderTotal(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + lineSubtotal(l), 0);
}

/** Order status is stored, but a corrupted/hand-edited total is repaired here. */
export function withConsistentTotal(order: Order): Order {
  const expected = orderTotal(order.items);
  return expected === order.total ? order : { ...order, total: expected };
}

// --- formatting -------------------------------------------------------------

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** "₹180" — no decimals anywhere in the UI; the cafe prices in whole rupees. */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return inr.format(0);
  return inr.format(Math.round(amount));
}

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatTime(epochMs: number): string {
  return timeFmt.format(new Date(epochMs));
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

export function formatDate(epochMs: number): string {
  return dateFmt.format(new Date(epochMs));
}

/** "just now" / "4m ago" / "1h 12m ago" — used by the staff board. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h ago` : `${hours}h ${minutes}m ago`;
}

/** Compact waiting timer for the staff board: "03:12" = 3m 12s. */
export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
