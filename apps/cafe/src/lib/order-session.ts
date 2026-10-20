/**
 * Per-table order session.
 *
 * Customers have no login (docs/requirements.md §3), so "my order" is remembered
 * with a single localStorage key per table. That's enough to make a refresh land
 * back on the live status screen instead of an empty menu.
 */

import { parseTableNumber } from "./tables";

const PREFIX = "cafe-qr-order.session-order.v1";

function key(tableNumber: number): string {
  return `${PREFIX}.t${tableNumber}`;
}

export function rememberSessionOrder(tableNumber: number, orderId: string) {
  try {
    globalThis.localStorage?.setItem(key(tableNumber), orderId);
  } catch {
    /* storage unavailable: a refresh just starts a new session */
  }
}

export function readSessionOrderId(tableNumber: number): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(tableNumber));
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function forgetSessionOrder(tableNumber: number) {
  try {
    globalThis.localStorage?.removeItem(key(tableNumber));
  } catch {
    /* no-op */
  }
}

export { parseTableNumber };
