/**
 * Sample month of orders for demo mode.
 *
 * The reports page is the hardest screen to evaluate with an empty database —
 * every figure is zero and the chart has no bars. This generates a plausible
 * month so the owner (and a screenshot) can see the real thing: a weekday/weekend
 * rhythm, a lunch peak, a mix of one-item and multi-item baskets, and a handful
 * of still-open orders so the staff board is not empty either.
 *
 * Demo mode only. Never imported by the Firestore path.
 */

import { SEED_MENU } from "./seed";
import type { Order } from "../types";
import type { OrderStatus } from "../order-status";

const MENU_IDS = SEED_MENU.filter((item) => item.available).map((i) => i.id);
const ALL_MENU = SEED_MENU.map((i) => i.id);

function priceOf(id: string): number {
  return SEED_MENU.find((i) => i.id === id)?.price ?? 0;
}
function nameOf(id: string): string {
  return SEED_MENU.find((i) => i.id === id)?.name ?? id;
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Builds `count` orders spread across the month containing `now`, ending at
 * roughly the current time so the "today" figures look plausible.
 */
export function buildSampleOrders(
  count = 240,
  now = Date.now(),
): Array<Omit<Order, "id" | "orderNumber">> {
  const start = new Date(
    new Date(now).getFullYear(),
    new Date(now).getMonth(),
    1,
  ).getTime();
  const elapsed = Math.max(60_000, now - start);

  // A cafe never has zero orders on the board, and the demo should not either.
  // The last few are pinned into the last few minutes so the staff board and the
  // customer's live status screen have something real to show.
  //
  // Their statuses cycle rather than being random: with only four open orders, a
  // random pick leaves "preparing" absent roughly 6% of the time, which is a
  // coin-flip flake in CI and an empty-looking board in the demo.
  const openCount = Math.max(4, Math.round(count * 0.03));
  const OPEN_CYCLE: OrderStatus[] = [
    "preparing",
    "ready",
    "served",
    "preparing",
  ];
  const orders: Array<Omit<Order, "id" | "orderNumber">> = [];

  for (let i = 0; i < count; i += 1) {
    const isOpen = i < openCount;
    // cluster the rest into service windows rather than spreading them evenly
    const slot = isOpen
      ? elapsed - Math.floor(Math.random() * elapsed * 0.001)
      : Math.floor(Math.random() ** 0.7 * elapsed * 0.85);
    const createdAt = start + Math.min(slot, now - 1);

    const size = Math.random() < 0.55 ? 1 : Math.random() < 0.85 ? 2 : 3;
    const items = Array.from({ length: size }, () => {
      const menuItemId = pick(MENU_IDS);
      return {
        menuItemId,
        name: nameOf(menuItemId),
        qty: Math.random() < 0.75 ? 1 : 2,
        price: priceOf(menuItemId),
      };
    });

    // a sold-out item occasionally appears in history, so the report shows one
    if (Math.random() < 0.04) {
      const soldOut = ALL_MENU.find(
        (id) => SEED_MENU.find((i2) => i2.id === id)?.available === false,
      );
      if (soldOut) {
        items.push({
          menuItemId: soldOut,
          name: nameOf(soldOut),
          qty: 1,
          price: priceOf(soldOut),
        });
      }
    }

    const total = items.reduce((sum, l) => sum + l.price * l.qty, 0);
    const age = now - createdAt;
    const status: OrderStatus = isOpen
      ? OPEN_CYCLE[i % OPEN_CYCLE.length]
      : age > 25 * 60_000
        ? "completed"
        : age > 12 * 60_000
          ? "served"
          : age > 5 * 60_000
            ? "ready"
            : "preparing";

    orders.push({
      tableNumber: 1 + Math.floor(Math.random() * 6),
      items,
      total,
      status,
      createdAt,
      completedAt: status === "completed" ? createdAt + 6 * 60_000 : undefined,
      paymentMethod: Math.random() < 0.7 ? "counter" : "upi",
      notes:
        Math.random() < 0.12
          ? pick(["No sugar please", "Extra hot", "To go"])
          : undefined,
    });
  }

  return orders.sort((a, b) => a.createdAt - b.createdAt);
}
