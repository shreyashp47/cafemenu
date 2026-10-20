/**
 * Cart reducer — pure, so it can be unit-tested without a DOM (issue #11).
 *
 * A cart is scoped to a *table* and persisted per table, so a dropped
 * connection or a phone that reloads mid-order never loses a basket
 * (docs/requirements.md §5.2: "cart-based ordering per table session").
 */

import { clampQty, MAX_QTY_PER_LINE } from "./money";
import type { CartLine, MenuItem } from "./types";

export type CartAction =
  | { type: "add"; item: MenuItem; qty?: number }
  | { type: "increment"; menuItemId: string; by?: number }
  | { type: "decrement"; menuItemId: string; by?: number }
  | { type: "setQty"; menuItemId: string; qty: number }
  | { type: "remove"; menuItemId: string }
  | { type: "clear" }
  | { type: "replace"; lines: CartLine[] }
  /** Called when a live menu update lands: drop sold-out/removed items. */
  | { type: "reconcile"; menu: MenuItem[] };

export function emptyCart(): CartLine[] {
  return [];
}

function toLine(item: MenuItem, qty: number): CartLine {
  return {
    menuItemId: item.id,
    name: item.name,
    price: item.price,
    qty: clampQty(qty),
    category: item.category,
  };
}

export function cartReducer(state: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      // Unavailable items can never enter the cart (issue #4 acceptance).
      if (!action.item.available) return state;
      const existing = state.find((l) => l.menuItemId === action.item.id);
      const by = action.qty ?? 1;
      if (existing) {
        return state.map((l) =>
          l.menuItemId === action.item.id
            ? { ...l, qty: clampQty(l.qty + by), price: action.item.price }
            : l,
        );
      }
      const next = [...state, toLine(action.item, by)];
      return next;
    }

    case "increment":
    case "decrement": {
      const by = action.by ?? 1;
      const delta = action.type === "increment" ? by : -by;
      return state
        .map((l) =>
          l.menuItemId === action.menuItemId
            ? { ...l, qty: clampQty(l.qty + delta) }
            : l,
        )
        .filter((l) => l.qty > 0);
    }

    case "setQty":
      return state
        .map((l) =>
          l.menuItemId === action.menuItemId
            ? { ...l, qty: clampQty(action.qty) }
            : l,
        )
        .filter((l) => l.qty > 0);

    case "remove":
      return state.filter((l) => l.menuItemId !== action.menuItemId);

    case "clear":
      return emptyCart();

    case "replace":
      return action.lines
        .filter((l) => l.qty > 0)
        .map((l) => ({ ...l, qty: clampQty(l.qty) }));

    case "reconcile": {
      const byId = new Map(action.menu.map((i) => [i.id, i]));
      const next: CartLine[] = [];
      for (const line of state) {
        const item = byId.get(line.menuItemId);
        // Item removed from the menu, or just marked sold out -> drop it.
        if (!item || !item.available) continue;
        next.push({ ...line, price: item.price });
      }
      return next;
    }

    default:
      return state;
  }
}

// --- persistence ------------------------------------------------------------

const PREFIX = "cafe-qr-order.cart.v1";

export function cartKey(tableNumber: number): string {
  return `${PREFIX}.t${tableNumber}`;
}

export function readStoredCart(tableNumber: number): CartLine[] {
  try {
    const raw = globalThis.localStorage?.getItem(cartKey(tableNumber));
    if (!raw) return emptyCart();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return emptyCart();
    return parsed
      .filter(
        (l): l is CartLine =>
          !!l &&
          typeof l === "object" &&
          typeof (l as CartLine).menuItemId === "string" &&
          typeof (l as CartLine).name === "string" &&
          typeof (l as CartLine).price === "number" &&
          typeof (l as CartLine).qty === "number",
      )
      .map((l) => ({ ...l, qty: clampQty(l.qty) }))
      .filter((l) => l.qty > 0);
  } catch {
    return emptyCart();
  }
}

export function writeStoredCart(tableNumber: number, lines: CartLine[]) {
  try {
    if (lines.length === 0)
      globalThis.localStorage?.removeItem(cartKey(tableNumber));
    else
      globalThis.localStorage?.setItem(
        cartKey(tableNumber),
        JSON.stringify(lines),
      );
  } catch {
    /* storage unavailable: cart simply won't survive a reload */
  }
}

export function clearStoredCart(tableNumber: number) {
  try {
    globalThis.localStorage?.removeItem(cartKey(tableNumber));
  } catch {
    /* no-op */
  }
}

export { MAX_QTY_PER_LINE, clampQty };
