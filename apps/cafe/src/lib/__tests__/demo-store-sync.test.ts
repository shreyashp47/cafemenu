/**
 * Another tab's writes reaching this one, in demo mode (issue #63).
 *
 * The demo's "server" is localStorage, shared by every tab of the origin. A
 * write in one tab reaches another as two separate deliveries: the new value
 * in the storage area, and anything the writing tab sends to say so. The
 * browser does not keep the two in order. A tab busy rendering the previous
 * update can be handed the announcement first, re-read the old state, and
 * then receive the new value with nothing left to tell it. That is how the
 * customer's screen stayed on "number coming…" after Accept while the number
 * sat in its own localStorage: the board's two writes (the order accepted,
 * then numbered) arrived a few milliseconds apart, and the second
 * announcement overtook its data.
 *
 * Here the test plays the other tab: it writes the state as that tab's commit
 * would, fires the `storage` event the browser fires once the value has
 * landed, and posts the old BroadcastChannel announcement ahead of the data,
 * as Chromium did in the failing runs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { demoOrderRepo } from "@/lib/data/demo";
import {
  DEMO_STORAGE_KEY,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import type { Order } from "@/lib/types";

/**
 * BroadcastChannel between "tabs" in one test: a message reaches every other
 * channel of the same name at once, so it can be made to arrive before the
 * data it announces.
 */
class LinkedChannel {
  static open = new Set<LinkedChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    LinkedChannel.open.add(this);
  }
  postMessage(data: unknown) {
    for (const other of LinkedChannel.open) {
      if (other !== this && other.name === this.name)
        other.onmessage?.(new MessageEvent("message", { data }));
    }
  }
  close() {
    LinkedChannel.open.delete(this);
  }
}
vi.stubGlobal("BroadcastChannel", LinkedChannel);

type State = ReturnType<typeof loadDemoState>;

/** The other tab: its view of the state, and how its writes reach this one. */
function otherTab() {
  const announce = new LinkedChannel("cafe-qr-order:sync");
  let view = loadDemoState();
  return {
    write(change: (state: State) => State, { announceFirst = false } = {}) {
      view = change(view);
      const raw = JSON.stringify(view);
      if (announceFirst) announce.postMessage("changed");
      // The value lands in this tab's storage area, and the browser says so.
      localStorage.setItem(DEMO_STORAGE_KEY, raw);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DEMO_STORAGE_KEY,
          newValue: raw,
          storageArea: localStorage,
        }),
      );
      if (!announceFirst) announce.postMessage("changed");
    },
  };
}

function setOrder(id: string, patch: Partial<Order>) {
  return (state: State): State => ({
    ...state,
    orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  });
}

beforeEach(() => {
  resetDemoStore();
});

describe("demo store: another tab's writes", () => {
  it("reach a listener even when the announcement overtakes the data", async () => {
    const order = await demoOrderRepo.create({
      tableNumber: 3,
      items: [{ menuItemId: "m1", name: "Cappuccino", qty: 1, price: 18000 }],
      total: 18000,
    });
    const seen: Array<Order | null> = [];
    const stop = demoOrderRepo.subscribeOrder(order.id, (o) => seen.push(o));

    // The board: Accept, then today's first number a moment later.
    const board = otherTab();
    board.write(setOrder(order.id, { status: "preparing" }));
    board.write(setOrder(order.id, { dayNumber: 1, dayKey: "2026-10-22" }), {
      announceFirst: true,
    });

    expect(seen.at(-1)).toMatchObject({ status: "preparing", dayNumber: 1 });
    stop();
  });

  it("ignores other keys' changes", async () => {
    const seen: unknown[] = [];
    const stop = demoOrderRepo.subscribeActive((orders) => seen.push(orders));
    const before = seen.length;

    // Another tab's cart, say: nothing the store holds has changed.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "cafe-qr-order.cart.v1",
        newValue: "[]",
        storageArea: localStorage,
      }),
    );

    expect(seen).toHaveLength(before);
    stop();
  });
});
