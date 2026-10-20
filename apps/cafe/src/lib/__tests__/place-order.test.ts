import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDemoStaffPin, getTableNumbers, isDemoMode } from "@/lib/config";
import { OrderRejected, placeOrder } from "@/lib/place-order";
import {
  ORDER_GAP_SECONDS,
  OrderThrottled,
  forgetLastOrder,
} from "@/lib/order-throttle";
import {
  forgetSessionOrder,
  readSessionOrderId,
  rememberSessionOrder,
} from "@/lib/order-session";
import { orderHref, parseTableNumber, readTableFromSearch } from "@/lib/tables";
import { demoMenuRepo, demoOrderRepo, demoSessionRepo } from "@/lib/data/demo";
import {
  demoSaveOrdering,
  demoSaveTableKeys,
  demoSetTableOpenUntil,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { TableCodeRefused } from "@/lib/place-order";
import type { CartLine, MenuItem } from "@/lib/types";

beforeEach(() => {
  resetDemoStore();
});

describe("table numbers", () => {
  it("accepts a positive integer string", () => {
    expect(parseTableNumber("4")).toBe(4);
    expect(parseTableNumber(" 12 ")).toBe(12);
  });

  it("accepts a positive integer", () => {
    expect(parseTableNumber(6)).toBe(6);
  });

  it("rejects zero, negatives, junk and huge values", () => {
    expect(parseTableNumber("0")).toBeNull();
    expect(parseTableNumber("-2")).toBeNull();
    expect(parseTableNumber("abc")).toBeNull();
    expect(parseTableNumber("")).toBeNull();
    expect(parseTableNumber("9999")).toBeNull();
    expect(parseTableNumber("1.5")).toBeNull();
    expect(parseTableNumber(null)).toBeNull();
    expect(parseTableNumber(undefined)).toBeNull();
    expect(parseTableNumber({})).toBeNull();
  });

  it("reads the table from a query string", () => {
    expect(readTableFromSearch("?table=7")).toBe(7);
    expect(readTableFromSearch("table=7&x=1")).toBe(7);
  });

  it("returns null when the table is missing or broken", () => {
    expect(readTableFromSearch("")).toBeNull();
    expect(readTableFromSearch("?table=banana")).toBeNull();
  });

  it("builds the QR target url", () => {
    expect(orderHref(3)).toBe("/order?table=3");
  });

  it("falls back to a sensible table list", () => {
    const tables = getTableNumbers();
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toEqual([...tables].sort((a, b) => a - b));
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe("order session", () => {
  it("remembers the order per table", () => {
    rememberSessionOrder(4, "o-123");
    expect(readSessionOrderId(4)).toBe("o-123");
  });

  it("keeps tables separate", () => {
    rememberSessionOrder(4, "o-123");
    expect(readSessionOrderId(5)).toBeNull();
  });

  it("forgets an order on request", () => {
    rememberSessionOrder(4, "o-123");
    forgetSessionOrder(4);
    expect(readSessionOrderId(4)).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readSessionOrderId(9)).toBeNull();
  });
});

describe("config", () => {
  it("runs in demo mode without Firebase env vars", () => {
    expect(isDemoMode).toBe(true);
  });

  it("always yields a usable staff PIN", () => {
    expect(getDemoStaffPin()).toMatch(/^\d{4,6}$/);
  });
});

describe("placeOrder", () => {
  const item = (over: Partial<MenuItem> = {}): MenuItem => ({
    id: "m1",
    name: "Cappuccino",
    description: "",
    price: 180,
    category: "Drinks",
    available: true,
    sortOrder: 10,
    ...over,
  });

  const line = (over: Partial<CartLine> = {}): CartLine => ({
    menuItemId: "m1",
    name: "Cappuccino",
    price: 180,
    qty: 1,
    category: "Drinks",
    ...over,
  });

  it("re-prices against the live menu, not the cart copy", async () => {
    const menu = [item({ price: 210 })];
    const order = await placeOrder({
      tableNumber: 2,
      cartLines: [line({ price: 150 })],
      menu,
    });
    expect(order.items[0].price).toBe(210);
    expect(order.total).toBe(210);
  });

  it("rejects a sold-out item with a customer-readable reason", async () => {
    await expect(
      placeOrder({
        tableNumber: 2,
        cartLines: [line()],
        menu: [item({ available: false })],
      }),
    ).rejects.toBeInstanceOf(OrderRejected);
  });

  it("rejects a deleted item", async () => {
    await expect(
      placeOrder({ tableNumber: 2, cartLines: [line()], menu: [] }),
    ).rejects.toThrow(/no longer on the menu/i);
  });

  it("rejects an empty basket", async () => {
    await expect(
      placeOrder({ tableNumber: 2, cartLines: [], menu: [item()] }),
    ).rejects.toThrow(/empty/i);
  });

  it("rejects an invalid table number", async () => {
    await expect(
      placeOrder({ tableNumber: 0, cartLines: [line()], menu: [item()] }),
    ).rejects.toThrow(/table/i);
  });

  it("writes through to the repository so the staff board sees it", async () => {
    const menu = await demoMenuRepo.list();
    const first = menu[0];
    const order = await placeOrder({
      tableNumber: 5,
      cartLines: [
        {
          menuItemId: first.id,
          name: first.name,
          price: first.price,
          qty: 2,
          category: first.category,
        },
      ],
      menu,
    });
    // "Approve new tables" is off by default, so it goes to the kitchen.
    expect(order.status).toBe("preparing");
    expect(order.tableNumber).toBe(5);
    expect(order.total).toBe(first.price * 2);
  });

  it("trims and drops an empty note", async () => {
    const menu = [item()];
    const withNote = await placeOrder({
      tableNumber: 1,
      cartLines: [line()],
      menu,
      notes: "  extra hot  ",
    });
    expect(withNote.notes).toBe("extra hot");

    forgetLastOrder(); // a second order straight away is the throttle's business
    const without = await placeOrder({
      tableNumber: 1,
      cartLines: [line()],
      menu,
      notes: "   ",
    });
    expect(without.notes).toBeUndefined();
  });

  describe("one order per customer per 30 seconds (issue #32)", () => {
    const place = () =>
      placeOrder({ tableNumber: 3, cartLines: [line()], menu: [item()] });
    const T0 = Date.parse("2026-09-27T10:00:00Z");

    it("lets a customer place one order", async () => {
      await expect(place()).resolves.toMatchObject({ tableNumber: 3 });
    });

    it("refuses a second order straight away, and says how long to wait", async () => {
      vi.useFakeTimers({ now: T0 });
      await place();
      vi.setSystemTime(T0 + 5_000);
      const second = place();
      await expect(second).rejects.toBeInstanceOf(OrderThrottled);
      await expect(second).rejects.toThrow(/another in 25 seconds/);
    });

    it("words the refusal for a customer, not a developer", async () => {
      vi.useFakeTimers({ now: T0 });
      await place();
      const err = await place().catch((e: unknown) => e);
      expect((err as Error).message).not.toMatch(/permission|firebase|denied/i);
    });

    it("allows the next order once the gap has passed", async () => {
      vi.useFakeTimers({ now: T0 });
      await place();
      vi.setSystemTime(T0 + ORDER_GAP_SECONDS * 1000);
      await expect(place()).resolves.toMatchObject({ tableNumber: 3 });
    });

    it("is not locked out by a note left while the clock was ahead", async () => {
      vi.useFakeTimers({ now: T0 + 3 * 3600_000 }); // clock three hours fast
      await place();
      vi.setSystemTime(T0); // corrected
      await expect(place()).resolves.toMatchObject({ tableNumber: 3 });
    });

    it("does not start the clock on an order that was refused", async () => {
      await expect(
        placeOrder({
          tableNumber: 3,
          cartLines: [line()],
          menu: [item({ available: false })],
        }),
      ).rejects.toBeInstanceOf(OrderRejected);
      await expect(place()).resolves.toBeTruthy();
    });
  });

  describe("new guests: approval off by default", () => {
    const place = (tableNumber = 4, tableKey?: string) =>
      placeOrder({
        tableNumber,
        cartLines: [line()],
        menu: [item()],
        tableKey,
      });
    beforeEach(() => {
      forgetLastOrder();
      vi.restoreAllMocks();
    });

    it("by default (approval off) sends a closed table's order straight to preparing", async () => {
      expect(loadDemoState().ordering.confirmNewGuests).toBe(false);
      const create = vi.spyOn(demoOrderRepo, "create");
      expect((await place()).status).toBe("preparing");
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe("waiting for the counter (owner has 'Approve new tables' on)", () => {
    const place = (tableNumber = 4, tableKey?: string) =>
      placeOrder({
        tableNumber,
        cartLines: [line()],
        menu: [item()],
        tableKey,
      });
    beforeEach(() => {
      forgetLastOrder();
      vi.restoreAllMocks();
      demoSaveOrdering({ confirmNewGuests: true });
    });

    it("sends an order from a closed table as pending", async () => {
      expect((await place()).status).toBe("pending");
      expect(loadDemoState().orders[0].status).toBe("pending");
    });

    it("sends it straight to preparing once staff have opened the table", async () => {
      demoSetTableOpenUntil(4, Date.now() + 3600_000);
      expect((await place()).status).toBe("preparing");
    });

    it("tries preparing on a table that closed within the phone's clock slack, then waits", async () => {
      // Closed two minutes ago by the server's time; the phone's clock may be
      // behind, so it guesses open, the rules refuse, and it falls back.
      const closedAt = Date.now();
      demoSetTableOpenUntil(4, closedAt);
      vi.useFakeTimers({ toFake: ["Date"], now: closedAt + 2 * 60_000 });
      const create = vi.spyOn(demoOrderRepo, "create");
      expect((await place()).status).toBe("pending");
      expect(create.mock.calls.map(([input]) => input.status)).toEqual([
        "preparing",
        "pending",
      ]);
      expect(loadDemoState().orders).toHaveLength(1);
    });

    it("does not bother trying preparing on a table closed well before", async () => {
      const closedAt = Date.now();
      demoSetTableOpenUntil(4, closedAt);
      vi.useFakeTimers({ toFake: ["Date"], now: closedAt + 10 * 60_000 });
      const create = vi.spyOn(demoOrderRepo, "create");
      expect((await place()).status).toBe("pending");
      expect(create.mock.calls.map(([input]) => input.status)).toEqual([
        "pending",
      ]);
    });

    it("waits again once the table's time has run out", async () => {
      demoSetTableOpenUntil(4, Date.now());
      expect((await place()).status).toBe("pending");
    });

    it("skips the wait when the owner has switched confirmation off", async () => {
      demoSaveOrdering({ confirmNewGuests: false });
      expect((await place()).status).toBe("preparing");
    });

    it("retries once as pending when the table closed a moment ago", async () => {
      // The phone saw the table open, the rules no longer agree.
      vi.spyOn(demoSessionRepo, "isOpen").mockResolvedValue(true);
      const create = vi.spyOn(demoOrderRepo, "create");
      const order = await place();
      expect(order.status).toBe("pending");
      expect(create.mock.calls.map(([input]) => input.status)).toEqual([
        "preparing",
        "pending",
      ]);
      expect(loadDemoState().orders).toHaveLength(1);
    });

    it("falls back to preparing if pending is refused (rules from before this change)", async () => {
      const real = demoOrderRepo.create.bind(demoOrderRepo);
      const create = vi
        .spyOn(demoOrderRepo, "create")
        .mockImplementation(async (input) => {
          if (input.status === "pending") {
            throw Object.assign(new Error("denied"), {
              code: "permission-denied",
            });
          }
          demoSaveOrdering({ confirmNewGuests: false }); // what the old rules allowed
          return real(input);
        });
      const order = await place();
      expect(order.status).toBe("preparing");
      expect(create.mock.calls.map(([input]) => input.status)).toEqual([
        "pending",
        "preparing",
      ]);
    });

    it("never lets that fallback skip the counter under the current rules", async () => {
      const create = vi.spyOn(demoOrderRepo, "create");
      demoSaveTableKeys({ 4: "RightCode1234" });
      await expect(place(4, "WrongCode1234")).rejects.toBeInstanceOf(
        TableCodeRefused,
      );
      expect(create.mock.calls.map(([input]) => input.status)).toEqual([
        "pending",
        "preparing",
      ]);
      expect(loadDemoState().orders).toHaveLength(0);
    });

    it("when it cannot check, tries preparing and falls back to pending", async () => {
      vi.spyOn(demoSessionRepo, "readSettings").mockRejectedValue(
        new Error("offline"),
      );
      const create = vi.spyOn(demoOrderRepo, "create");
      expect((await place()).status).toBe("pending");
      expect(create.mock.calls.map(([input]) => input.status)).toEqual([
        "preparing",
        "pending",
      ]);
      expect(loadDemoState().orders).toHaveLength(1);
    });

    it("when it cannot check but the table is open, goes straight through", async () => {
      vi.spyOn(demoSessionRepo, "readSettings").mockRejectedValue(
        new Error("offline"),
      );
      demoSetTableOpenUntil(4, Date.now() + 3600_000);
      expect((await place()).status).toBe("preparing");
    });

    it("still reports a wrong table code after the retry", async () => {
      demoSaveTableKeys({ 4: "RightCode1234" });
      vi.spyOn(demoSessionRepo, "isOpen").mockResolvedValue(true);
      const create = vi.spyOn(demoOrderRepo, "create");
      await expect(place(4, "WrongCode1234")).rejects.toBeInstanceOf(
        TableCodeRefused,
      );
      expect(create).toHaveBeenCalledTimes(2);
      expect(loadDemoState().orders).toHaveLength(0);
    });
  });
});
