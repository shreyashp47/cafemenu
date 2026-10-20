/**
 * The anti-abuse pieces around ordering: per-table codes, order size caps, and
 * staff rejecting an order. The real enforcement is firestore.rules (see
 * scripts/rules-test.mjs); these pin the client half and the demo store's
 * mirror of the rules, so the demo refuses exactly what the live app refuses.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { demoAuthRepo, demoConfigRepo, demoOrderRepo } from "@/lib/data/demo";
import { loadDemoState, resetDemoStore } from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import {
  MAX_ORDER_LINES,
  MAX_ORDER_TOTAL,
  MAX_QTY_PER_LINE,
  orderCapProblems,
} from "@/lib/order-caps";
import { forgetLastOrder } from "@/lib/order-throttle";
import { OrderRejected, TableCodeRefused, placeOrder } from "@/lib/place-order";
import { buildReport, ordersToCsv } from "@/lib/reports";
import {
  TABLE_KEY_LENGTH,
  forgetTableKeys,
  generateTableKey,
  isTableKey,
  readTableKey,
  rememberTableKey,
  tablesWithoutKey,
} from "@/lib/table-keys";
import { orderHref } from "@/lib/tables";
import {
  parseOrder,
  type CartLine,
  type MenuItem,
  type Order,
} from "@/lib/types";

const rules = () =>
  readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");

async function signInOwner() {
  await demoAuthRepo.signIn(
    DEMO_CREDENTIALS.owner.email,
    DEMO_CREDENTIALS.owner.password,
  );
}

beforeEach(async () => {
  resetDemoStore();
  forgetTableKeys();
  forgetLastOrder();
  await demoAuthRepo.signOut();
});

describe("table codes", () => {
  it("generates long base62 codes", () => {
    const key = generateTableKey();
    expect(key).toHaveLength(TABLE_KEY_LENGTH);
    expect(key).toMatch(/^[A-Za-z0-9]+$/);
    expect(isTableKey(key)).toBe(true);
  });

  it("does not repeat itself", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateTableKey()));
    expect(keys.size).toBe(200);
  });

  it("throws away bytes that would bias the alphabet", () => {
    // 248..255 must be skipped, not folded onto A..H.
    let call = 0;
    const fill = (b: Uint8Array) => {
      b.fill(call++ === 0 ? 255 : 0);
      return b;
    };
    expect(generateTableKey(10, fill)).toBe("AAAAAAAAAA");
    expect(call).toBe(2);
  });

  it("only accepts a code of the shape the rules allow", () => {
    expect(isTableKey("abcdefghij")).toBe(true);
    expect(isTableKey("short")).toBe(false);
    expect(isTableKey("a".repeat(65))).toBe(false);
    expect(isTableKey("has space12")).toBe(false);
    expect(isTableKey("x'); drop--")).toBe(false);
    expect(isTableKey(null)).toBe(false);
  });

  it("uses the same length and alphabet as firestore.rules", () => {
    const r = rules();
    expect(r).toContain(
      'request.resource.data.key.matches("^[A-Za-z0-9]{10,64}$")',
    );
    expect(r).toContain("request.resource.data.tableKey.size() <= 64");
  });

  it("puts the code into the table's link", () => {
    expect(orderHref(3)).toBe("/order?table=3");
    expect(orderHref(3, "Abc123xyz9")).toBe("/order?table=3&k=Abc123xyz9");
    expect(orderHref(3, null)).toBe("/order?table=3");
  });

  it("lists the tables still without a code", () => {
    expect(tablesWithoutKey([1, 2, 3], { 2: "Abc123xyz9" })).toEqual([1, 3]);
    expect(tablesWithoutKey([1], { 1: "bad" })).toEqual([1]);
  });

  it("remembers a scanned code per table, newest scan winning", () => {
    expect(readTableKey(4)).toBeNull();
    rememberTableKey(4, "FirstCode12");
    rememberTableKey(4, "SecondCode1");
    expect(readTableKey(4)).toBe("SecondCode1");
    expect(readTableKey(5)).toBeNull();
    rememberTableKey(5, "junk");
    expect(readTableKey(5)).toBeNull();
  });
});

describe("order size caps", () => {
  it("allows an ordinary order", () => {
    expect(orderCapProblems([{ qty: 2 }], 360)).toEqual([]);
  });

  it("explains each limit in words", () => {
    const lines = Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({
      qty: 1,
    }));
    expect(orderCapProblems(lines, 100)[0]).toMatch(/split it into two/);
    expect(orderCapProblems([{ qty: MAX_QTY_PER_LINE + 1 }], 100)[0]).toMatch(
      /Up to 20 of each/,
    );
    expect(orderCapProblems([{ qty: 1 }], MAX_ORDER_TOTAL + 1)[0]).toMatch(
      /₹10,000/,
    );
    expect(orderCapProblems([{ qty: 1 }], MAX_ORDER_TOTAL)).toEqual([]);
  });

  it("uses the same numbers as firestore.rules", () => {
    const r = rules();
    expect(r).toContain(
      `request.resource.data.items.size() <= ${MAX_ORDER_LINES}`,
    );
    expect(r).toContain(`request.resource.data.total <= ${MAX_ORDER_TOTAL}`);
    expect(r).toContain(
      `request.resource.data.items[0].qty <= ${MAX_QTY_PER_LINE}`,
    );
  });
});

describe("placing an order with table codes (demo store mirrors the rules)", () => {
  const menu: MenuItem[] = [
    {
      id: "m1",
      name: "Cappuccino",
      description: "",
      price: 180,
      category: "Drinks",
      available: true,
      sortOrder: 10,
    },
  ];
  const cart: CartLine[] = [
    {
      menuItemId: "m1",
      name: "Cappuccino",
      price: 180,
      qty: 1,
      category: "Drinks",
    },
  ];
  const order = (tableKey?: string | null) =>
    placeOrder({ tableNumber: 3, cartLines: cart, menu, tableKey });

  it("a table with no code takes an order without one (the transition)", async () => {
    await expect(order()).resolves.toMatchObject({ tableNumber: 3 });
  });

  it("a table with a code takes the right code", async () => {
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: "RightCode123" });
    await expect(order("RightCode123")).resolves.toMatchObject({
      tableNumber: 3,
    });
  });

  it("a typed-in address with no code is told to scan", async () => {
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: "RightCode123" });
    const err = await order().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TableCodeRefused);
    expect((err as Error).message).toBe(
      "To order, please scan the QR code on your table.",
    );
  });

  it("an old card's code is told the link has expired", async () => {
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: "RightCode123" });
    await expect(order("OldCardCode1")).rejects.toThrow(
      "This link has expired — please scan the QR code on your table.",
    );
  });

  it("refuses an order over the total cap before sending it", async () => {
    const big: CartLine[] = Array.from({ length: 12 }, (_, i) => ({
      menuItemId: `b${i}`,
      name: `Cake ${i}`,
      price: 1000,
      qty: 1,
      category: "Cakes",
    }));
    const bigMenu: MenuItem[] = big.map((l) => ({
      id: l.menuItemId,
      name: l.name,
      description: "",
      price: l.price,
      category: l.category,
      available: true,
      sortOrder: 1,
    }));
    await expect(
      placeOrder({ tableNumber: 3, cartLines: big, menu: bigMenu }),
    ).rejects.toBeInstanceOf(OrderRejected);
    expect(loadDemoState().orders).toHaveLength(0);
  });
});

describe("table codes are owner-only in the demo too", () => {
  it("refuses a barista's attempt to read them", async () => {
    await demoAuthRepo.signInWithPin("1122");
    const errors: Error[] = [];
    demoConfigRepo.subscribeTableKeys(
      () => {},
      (e) => errors.push(e),
    );
    expect(errors).toHaveLength(1);
    await expect(
      demoConfigRepo.saveTableKeys({ 1: "BaristaCode1" }),
    ).rejects.toThrow();
  });

  it("gives the owner a live list", async () => {
    await signInOwner();
    const seen: Array<Record<number, string>> = [];
    const stop = demoConfigRepo.subscribeTableKeys((k) => seen.push({ ...k }));
    await demoConfigRepo.saveTableKeys({ 2: "OwnerCode123" });
    expect(seen.at(-1)).toEqual({ 2: "OwnerCode123" });
    stop();
  });
});

describe("rejecting an order (demo store mirrors the rules)", () => {
  const place = () =>
    demoOrderRepo.create({
      tableNumber: 2,
      items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
      total: 200,
    });

  it("takes it off the board, with the reason", async () => {
    const o = await place();
    await demoOrderRepo.reject(o.id, "  Duplicate order ");
    const stored = loadDemoState().orders.find((x) => x.id === o.id);
    expect(stored?.status).toBe("rejected");
    expect(stored?.rejectReason).toBe("Duplicate order");
    const board: Order[][] = [];
    demoOrderRepo.subscribeActive((orders) => board.push(orders))();
    expect(board.at(-1)).toEqual([]);
  });

  it("works without a reason", async () => {
    const o = await place();
    await demoOrderRepo.reject(o.id);
    const stored = loadDemoState().orders.find((x) => x.id === o.id);
    expect(stored?.status).toBe("rejected");
    expect(stored?.rejectReason).toBeUndefined();
  });

  it("refuses once served, and refuses twice", async () => {
    const o = await place();
    await demoOrderRepo.setStatus(o.id, "ready");
    await demoOrderRepo.setStatus(o.id, "served");
    await expect(demoOrderRepo.reject(o.id)).rejects.toThrow();
    const p = await place();
    await demoOrderRepo.reject(p.id);
    await expect(demoOrderRepo.reject(p.id)).rejects.toThrow();
  });

  it("only reads a reason back on a rejected order", () => {
    const base = {
      id: "o-1",
      tableNumber: 1,
      items: [],
      total: 0,
      createdAt: 1,
      rejectReason: "x".repeat(200),
    };
    expect(parseOrder({ ...base, status: "rejected" })?.rejectReason).toBe(
      "x".repeat(80),
    );
    expect(
      parseOrder({ ...base, status: "preparing" })?.rejectReason,
    ).toBeUndefined();
    // The table code travels on the order document for the rules only.
    expect(
      parseOrder({ ...base, status: "preparing", tableKey: "Secret12345" }),
    ).not.toHaveProperty("tableKey");
  });
});

describe("reports leave rejected orders out", () => {
  const at = new Date(2026, 8, 10, 12).getTime();
  const mk = (
    id: string,
    status: Order["status"],
    price: number,
    extra: Partial<Order> = {},
  ): Order => ({
    id,
    orderNumber: 100,
    tableNumber: 1,
    items: [{ menuItemId: id, name: `Item ${id}`, qty: 1, price }],
    total: price,
    status,
    createdAt: at,
    paymentMethod: "counter",
    ...extra,
  });
  const orders = [
    mk("a", "completed", 200),
    mk("b", "rejected", 9000, { rejectReason: "No one at this table" }),
    mk("c", "preparing", 100),
  ];
  const range = { from: at - 1000, to: at + 1000 };

  it("from revenue, order count, best sellers and the chart", () => {
    const report = buildReport(orders, range);
    expect(report.revenue).toBe(300);
    expect(report.orderCount).toBe(2);
    expect(report.averageOrderValue).toBe(150);
    expect(report.topItems.map((i) => i.name)).not.toContain("Item b");
    expect(report.byDay[0]).toMatchObject({ revenue: 300, orders: 2 });
  });

  it("but still counts them, so the owner can see how many there were", () => {
    const report = buildReport(orders, range);
    expect(report.rejectedCount).toBe(1);
    expect(report.statusCounts.rejected).toBe(1);
  });

  it("and keeps them in the CSV, marked, with the reason", () => {
    const csv = ordersToCsv(orders).split("\n");
    expect(csv[0]).toContain("Status");
    expect(csv[0]).toContain("Reject reason");
    const row = csv.find((l) => l.includes("Item b"));
    expect(row).toContain(",rejected,");
    expect(row).toContain("No one at this table");
  });
});
