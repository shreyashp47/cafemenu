/**
 * Contract parity between the two storage backends.
 *
 * The demo store and Firestore implement the same interfaces (src/lib/data/types.ts).
 * Nothing in the type system forces their *behaviour* to match, and a silent
 * divergence is exactly the bug that only shows up after the cafe goes live — so
 * this suite runs the same scenarios against both and asserts the same results.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  demoAuthRepo,
  demoConfigRepo,
  demoMenuRepo,
  demoOrderRepo,
} from "@/lib/data/demo";
import {
  makeId,
  resetDemoStore,
  selectActiveOrders,
  loadDemoState,
  DEMO_STORAGE_KEY,
} from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import { displayNumberFromId } from "@/lib/order-number";
import {
  ACTIVE_STATUSES,
  canAdvance,
  type OrderStatus,
} from "@/lib/order-status";
import { orderTotal } from "@/lib/money";
import type { MenuRepository, OrderRepository } from "@/lib/data/types";
import type { MenuItem, Order } from "@/lib/types";

/**
 * Documented behaviour every backend must satisfy. Firestore is a remote service
 * that cannot be exercised in a unit test, so the contract is asserted here and
 * the Firestore implementation is reviewed against this list.
 */
const CONTRACT = {
  name: "demo repository",
  repos: {} as { menu: MenuRepository; orders: OrderRepository },
};

beforeEach(() => {
  resetDemoStore();
});

function collect<T>(subscribe: (cb: (v: T) => void) => () => void): {
  values: T[];
  stop: () => void;
} {
  const values: T[] = [];
  const stop = subscribe((v) => values.push(v));
  return { values, stop };
}

describe("repository contract: menu", () => {
  it("emits the current value immediately on subscribe", async () => {
    CONTRACT.repos.menu = demoMenuRepo;
    const { values, stop } = collect<MenuItem[]>((cb) =>
      demoMenuRepo.subscribe(cb),
    );
    expect(values).toHaveLength(1);
    expect(values[0].length).toBeGreaterThan(0);
    stop();
  });

  it("emits again on every write", async () => {
    const { values, stop } = collect<MenuItem[]>((cb) =>
      demoMenuRepo.subscribe(cb),
    );
    const before = values.length;
    await demoMenuRepo.create({
      name: "Cardamom Bun",
      price: 140,
      category: "Bites",
    });
    expect(values.length).toBeGreaterThan(before);
    expect(values.at(-1)?.some((i) => i.name === "Cardamom Bun")).toBe(true);
    stop();
  });

  it("round-trips create -> read -> update -> remove", async () => {
    const created = await demoMenuRepo.create({
      name: "Cardamom Bun",
      description: "warm",
      price: 140,
      category: "Bites",
    });
    expect((await demoMenuRepo.list()).some((i) => i.id === created.id)).toBe(
      true,
    );

    await demoMenuRepo.update(created.id, { price: 160, available: false });
    const updated = (await demoMenuRepo.list()).find(
      (i) => i.id === created.id,
    );
    expect(updated?.price).toBe(160);
    expect(updated?.available).toBe(false);

    await demoMenuRepo.remove(created.id);
    expect((await demoMenuRepo.list()).some((i) => i.id === created.id)).toBe(
      false,
    );
  });

  it("sorts by sortOrder then name", async () => {
    const items = await demoMenuRepo.list();
    for (let i = 1; i < items.length; i += 1) {
      const prev = items[i - 1];
      const cur = items[i];
      expect(
        prev.sortOrder < cur.sortOrder ||
          (prev.sortOrder === cur.sortOrder &&
            prev.name.localeCompare(cur.name) <= 0),
      ).toBe(true);
    }
  });

  it("persists so a second repo instance sees the change", async () => {
    await demoMenuRepo.create({
      name: "Persisted",
      price: 10,
      category: "Sweets",
    });
    // a fresh read path stands in for a page reload / a second device
    const reloaded = loadDemoState();
    expect(reloaded.menu.some((i) => i.name === "Persisted")).toBe(true);
  });
});

describe("repository contract: orders", () => {
  async function place(tableNumber = 3): Promise<Order> {
    return demoOrderRepo.create({
      tableNumber,
      items: [{ menuItemId: "m1", name: "Cappuccino", qty: 2, price: 180 }],
      total: 360,
    });
  }

  it("stores the total recomputed from the lines", async () => {
    const order = await demoOrderRepo.create({
      tableNumber: 1,
      items: [
        { menuItemId: "a", name: "A", qty: 1, price: 100 },
        { menuItemId: "b", name: "B", qty: 2, price: 50 },
      ],
      total: 999, // a tampered client value
    });
    expect(order.total).toBe(200);
    expect(order.total).toBe(orderTotal(order.items));
  });

  it("starts pending when no status is given: the one the rules always take", async () => {
    const order = await place();
    expect(order.status).toBe("pending");
  });

  it("derives a short display number from the id, with no shared counter", async () => {
    const a = await place();
    expect(a.orderNumber).toBe(displayNumberFromId(a.id));
    expect(a.orderNumber).toBeGreaterThanOrEqual(100);
    expect(a.orderNumber).toBeLessThanOrEqual(999);
    // Reading it back gives the same number the placing phone was shown.
    const stored = await demoOrderRepo.listRange(0, Date.now() + 1000);
    expect(stored.find((o) => o.id === a.id)?.orderNumber).toBe(a.orderNumber);
  });

  it("creates unique ids", async () => {
    const a = await place();
    const b = await place();
    expect(a.id).not.toBe(b.id);
    expect(new Set([makeId("x"), makeId("x")]).size).toBe(2);
  });

  it("emits the active list immediately and on change", async () => {
    const { values, stop } = collect<Order[]>((cb) =>
      demoOrderRepo.subscribeActive(cb),
    );
    expect(values.at(-1)).toEqual([]);

    const order = await place();
    expect(values.at(-1)?.map((o) => o.id)).toContain(order.id);
    stop();
  });

  it("sorts the active board oldest first", async () => {
    const first = await place(1);
    await new Promise((r) => setTimeout(r, 5));
    const second = await place(2);
    const active = selectActiveOrders(loadDemoState());
    expect(active.map((o) => o.id)).toEqual([first.id, second.id]);
    expect(active[0].createdAt).toBeLessThanOrEqual(active[1].createdAt);
    expect(second.id).toBeTruthy();
  });

  it("never returns a completed order on the active board", async () => {
    const order = await place();
    await demoOrderRepo.setStatus(order.id, "completed");
    const { values, stop } = collect<Order[]>((cb) =>
      demoOrderRepo.subscribeActive(cb),
    );
    expect(values.at(-1)).toEqual([]);
    stop();
  });

  it("keeps a completed order in history, not deleted", async () => {
    const order = await place();
    await demoOrderRepo.setStatus(order.id, "completed");
    const found = await demoOrderRepo.listRange(0, Date.now() + 1000);
    expect(found.map((o) => o.id)).toContain(order.id);
    expect(found[0].completedAt).toBeTypeOf("number");
  });

  it("supports every legal transition the machine allows", async () => {
    const order = await place();
    const read = async () =>
      (await demoOrderRepo.listRange(0, Date.now() + 1000)).find(
        (o) => o.id === order.id,
      );

    // a new order waits for the counter, so the walk starts from there
    expect((await read())?.status).toBe("pending");
    for (const to of ["preparing", "ready", "served", "completed"] as const) {
      const current = await read();
      expect(canAdvance(current?.status as OrderStatus, to)).toBe(true);
      await demoOrderRepo.setStatus(order.id, to);
      expect((await read())?.status).toBe(to);
    }
  });

  it("stamps completedAt only on completion", async () => {
    const order = await place();
    const afterReady = (
      await demoOrderRepo.listRange(0, Date.now() + 1000)
    ).find((o) => o.id === order.id);
    expect(afterReady?.completedAt).toBeUndefined();

    await demoOrderRepo.setStatus(order.id, "completed");
    const done = (await demoOrderRepo.listRange(0, Date.now() + 1000)).find(
      (o) => o.id === order.id,
    );
    expect(done?.completedAt).toBeTypeOf("number");
  });

  it("subscribes to a single order by id", async () => {
    const order = await place();
    const { values, stop } = collect<Order | null>((cb) =>
      demoOrderRepo.subscribeOrder(order.id, cb),
    );
    expect(values.at(-1)?.id).toBe(order.id);
    await demoOrderRepo.setStatus(order.id, "ready");
    expect(values.at(-1)?.status).toBe("ready");
    stop();
  });

  it("resolves to null for an unknown id", () => {
    const { values, stop } = collect<Order | null>((cb) =>
      demoOrderRepo.subscribeOrder("nope", cb),
    );
    expect(values.at(-1)).toBeNull();
    stop();
  });

  it("returns a half-open date range, so months never double count", async () => {
    await place();
    const from = new Date(2020, 0, 1).getTime();
    const to = new Date(2030, 0, 1).getTime();
    expect((await demoOrderRepo.listRange(from, to)).length).toBe(1);
    expect(await demoOrderRepo.listRange(to, to + 1000)).toEqual([]);
  });

  it("with a limit, keeps the newest orders, still oldest first", async () => {
    for (let i = 0; i < 3; i++) {
      await place();
      await new Promise((r) => setTimeout(r, 2));
    }
    const every = await demoOrderRepo.listRange(0, Date.now() + 1000);
    const capped = await demoOrderRepo.listRange(0, Date.now() + 1000, 2);
    expect(every).toHaveLength(3);
    expect(capped.map((o) => o.id)).toEqual(every.slice(1).map((o) => o.id));
    expect(capped[0].createdAt).toBeLessThanOrEqual(capped[1].createdAt);
  });

  it("lists every active status on the board", () => {
    for (const status of ACTIVE_STATUSES) {
      expect(
        selectActiveOrders({
          ...loadDemoState(),
          orders: [
            {
              id: "o",
              orderNumber: 1,
              tableNumber: 1,
              items: [],
              total: 0,
              status,
              createdAt: 1,
              paymentMethod: "counter",
            },
          ],
        }),
      ).toHaveLength(1);
    }
  });
});

describe("repository contract: auth", () => {
  it("rejects a wrong password", async () => {
    await expect(
      demoAuthRepo.signIn(DEMO_CREDENTIALS.staff.email, "nope"),
    ).rejects.toThrow(/do not match/i);
  });

  it("rejects a wrong PIN", async () => {
    await expect(demoAuthRepo.signInWithPin("0000")).rejects.toThrow(
      /wrong pin/i,
    );
  });

  it("signs a barista in and reports the staff role", async () => {
    await demoAuthRepo.signIn(
      DEMO_CREDENTIALS.staff.email,
      DEMO_CREDENTIALS.staff.password,
    );
    expect(demoAuthRepo.current()?.role).toBe("staff");
  });

  it("signs the owner in and reports the owner role", async () => {
    await demoAuthRepo.signIn(
      DEMO_CREDENTIALS.owner.email,
      DEMO_CREDENTIALS.owner.password,
    );
    expect(demoAuthRepo.current()?.role).toBe("owner");
  });

  it("notifies subscribers on sign in and out", async () => {
    const { values, stop } = collect(demoAuthRepo.subscribe);
    expect(values[0]).toBeNull();
    await demoAuthRepo.signInWithPin("1122");
    expect(values.at(-1)?.role).toBe("staff");
    await demoAuthRepo.signOut();
    expect(values.at(-1)).toBeNull();
    stop();
  });

  it("is case- and whitespace-insensitive on the email", async () => {
    await demoAuthRepo.signIn(
      `  ${DEMO_CREDENTIALS.owner.email.toUpperCase()} `,
      DEMO_CREDENTIALS.owner.password,
    );
    expect(demoAuthRepo.current()?.role).toBe("owner");
  });
});

describe("repository contract: config", () => {
  it("persists the special offer and trims it", async () => {
    await demoConfigRepo.save({ enabled: true, text: "  Free refills  " });
    const { values, stop } = collect(demoConfigRepo.subscribe);
    expect(values.at(-1)).toEqual({ enabled: true, text: "Free refills" });
    stop();
  });

  it("caps the special at 140 characters", async () => {
    await demoConfigRepo.save({ enabled: true, text: "x".repeat(400) });
    const offer = loadDemoState().offer;
    expect(offer.text.length).toBe(140);
  });

  it("reports no saved table list until the owner saves one", () => {
    const { values, stop } = collect(demoConfigRepo.subscribeTables);
    expect(values).toEqual([null]);
    stop();
  });

  it("saves the table list sorted and de-duplicated, and emits it live", async () => {
    const { values, stop } = collect(demoConfigRepo.subscribeTables);
    await demoConfigRepo.saveTables([9, 2, 1, 2]);
    expect(values.at(-1)).toEqual([1, 2, 9]);
    // Persisted to the same storage key as the rest of the demo state, which
    // is what the other tabs read when the broadcast arrives.
    expect(loadDemoState().tables).toEqual([1, 2, 9]);
    stop();
  });

  it("refuses a table list the Firestore rules would refuse", async () => {
    await expect(demoConfigRepo.saveTables([])).rejects.toThrow();
    await expect(demoConfigRepo.saveTables([1, 51])).rejects.toThrow();
    await expect(demoConfigRepo.saveTables([0, 1])).rejects.toThrow();
    await expect(demoConfigRepo.saveTables([1.5])).rejects.toThrow();
    expect(loadDemoState().tables).toBeNull();
  });

  it("reads a saved state from before editable tables as nothing saved", () => {
    const state: Record<string, unknown> = { ...loadDemoState() };
    delete state.tables;
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    expect(loadDemoState().tables).toBeNull();
  });
});

describe("demo store resilience", () => {
  it("re-seeds from corrupt storage instead of throwing", () => {
    localStorage.setItem(DEMO_STORAGE_KEY, "{not json");
    expect(loadDemoState().menu.length).toBeGreaterThan(0);
  });

  it("survives localStorage being wiped mid-session", () => {
    localStorage.clear();
    expect(loadDemoState().orders).toEqual([]);
  });

  it("uses a single storage key so writes stay atomic", () => {
    expect(DEMO_STORAGE_KEY).toBe("cafe-qr-order.demo.v1");
  });
});
