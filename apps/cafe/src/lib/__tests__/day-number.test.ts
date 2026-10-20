import { describe, expect, it, vi } from "vitest";

import {
  assignInTransaction,
  createDayNumberAssigner,
  DayNumbersExhausted,
  type DayNumberTx,
} from "../day-number";
import {
  displayNumberFromId,
  istDayKey,
  orderLabel,
  padDayNumber,
} from "../order-number";
import { parseOrder } from "../types";

describe("istDayKey", () => {
  it("turns over at 18:30 UTC, which is midnight in India", () => {
    expect(istDayKey(Date.parse("2026-09-27T18:29:59.999Z"))).toBe(
      "2026-09-27",
    );
    expect(istDayKey(Date.parse("2026-09-27T18:30:00.000Z"))).toBe(
      "2026-09-28",
    );
  });

  it("files an early-morning UTC time under the same IST day", () => {
    expect(istDayKey(Date.parse("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
    expect(istDayKey(Date.parse("2026-09-28T18:29:00Z"))).toBe("2026-09-28");
  });

  it("crosses months and years", () => {
    expect(istDayKey(Date.parse("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
    expect(istDayKey(Date.parse("2026-02-28T19:00:00Z"))).toBe("2026-03-01");
  });

  it("does not depend on the device's time zone", () => {
    // The sum is done on UTC milliseconds, so the answer is the same whatever
    // zone the process runs in. Spot-check against Intl in Asia/Kolkata.
    const ms = Date.parse("2026-09-27T20:15:00Z");
    const viaIntl = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ms);
    expect(istDayKey(ms)).toBe(viaIntl);
  });
});

describe("display", () => {
  it("pads to four digits", () => {
    expect(padDayNumber(1)).toBe("0001");
    expect(padDayNumber(7)).toBe("0007");
    expect(padDayNumber(42)).toBe("0042");
    expect(padDayNumber(9999)).toBe("9999");
  });

  it("prefers the day number, then a stored number, then a derived one", () => {
    expect(orderLabel({ orderNumber: 417, dayNumber: 7 })).toBe("#0007");
    expect(orderLabel({ orderNumber: 187 })).toBe("#187");

    const base = {
      tableNumber: 4,
      items: [{ name: "Latte", qty: 1, price: 180 }],
      total: 180,
      status: "preparing",
      createdAt: 1,
    };
    const numbered = parseOrder({
      ...base,
      id: "n",
      orderNumber: 187,
      dayNumber: 7,
      dayKey: "2026-09-28",
    })!;
    expect(orderLabel(numbered)).toBe("#0007");
    const legacy = parseOrder({ ...base, id: "l", orderNumber: 187 })!;
    expect(orderLabel(legacy)).toBe("#187");
    const derived = parseOrder({ ...base, id: "d" })!;
    expect(orderLabel(derived)).toBe(`#${displayNumberFromId("d")}`);
  });

  it("ignores a malformed day number or one without its day", () => {
    const base = {
      id: "x",
      tableNumber: 4,
      items: [],
      total: 0,
      status: "preparing",
      createdAt: 1,
    };
    for (const bad of [
      { dayNumber: 0, dayKey: "2026-09-28" },
      { dayNumber: 10000, dayKey: "2026-09-28" },
      { dayNumber: 1.5, dayKey: "2026-09-28" },
      { dayNumber: "7", dayKey: "2026-09-28" },
      { dayNumber: 7 },
      { dayNumber: 7, dayKey: "28/09/2026" },
    ]) {
      expect(parseOrder({ ...base, ...bad })?.dayNumber).toBeUndefined();
    }
  });
});

// --- a fake Firestore with optimistic transactions --------------------------

/**
 * Enough of Firestore's transaction model to test the race: reads record the
 * version they saw, and the commit fails (and is retried, as the SDK does) if
 * any of them changed. Each await yields, so concurrent transactions really do
 * interleave.
 */
function fakeDb(
  orders: Record<string, { createdAt: number; status?: string }>,
) {
  const docs = new Map<
    string,
    { version: number; data: Record<string, unknown> }
  >();
  for (const [id, data] of Object.entries(orders)) {
    docs.set(`orders/${id}`, { version: 1, data: { ...data } });
  }
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  let commits = 0;

  async function run<T>(body: (tx: DayNumberTx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const seen = new Map<string, number>();
      const writes = new Map<string, Record<string, unknown>>();
      const read = async (path: string) => {
        await tick();
        const doc = docs.get(path);
        seen.set(path, doc?.version ?? 0);
        return doc?.data;
      };
      const tx: DayNumberTx = {
        async readOrder(id) {
          const d = await read(`orders/${id}`);
          return d
            ? {
                createdAt: d.createdAt as number,
                dayNumber: d.dayNumber,
                status: d.status as string | undefined,
              }
            : null;
        },
        async readCounter(dayKey) {
          const d = await read(`dayCounters/${dayKey}`);
          return d ? (d.next as number) : null;
        },
        write({ id, dayKey, dayNumber }) {
          const o = docs.get(`orders/${id}`)!.data;
          writes.set(`orders/${id}`, { ...o, dayNumber, dayKey });
          writes.set(`dayCounters/${dayKey}`, { next: dayNumber + 1 });
        },
      };
      const result = await body(tx);
      await tick();
      const stale = [...seen].some(
        ([path, v]) => (docs.get(path)?.version ?? 0) !== v,
      );
      if (stale) continue;
      for (const [path, data] of writes) {
        docs.set(path, { version: (docs.get(path)?.version ?? 0) + 1, data });
      }
      if (writes.size) commits += 1;
      return result;
    }
    throw Object.assign(new Error("contention"), { code: "aborted" });
  }

  return {
    assign: (id: string) => run((tx) => assignInTransaction(tx, id)),
    order: (id: string) => docs.get(`orders/${id}`)?.data,
    setStatus: (id: string, status: string) => {
      const d = docs.get(`orders/${id}`)!;
      docs.set(`orders/${id}`, {
        version: d.version + 1,
        data: { ...d.data, status },
      });
    },
    counter: (key: string) => docs.get(`dayCounters/${key}`)?.data.next,
    commits: () => commits,
  };
}

const T = Date.parse("2026-09-28T05:00:00Z"); // 10:30 IST

describe("assignInTransaction", () => {
  it("starts a day at 1 and counts up", async () => {
    const db = fakeDb({ a: { createdAt: T }, b: { createdAt: T + 1 } });
    expect(await db.assign("a")).toEqual({
      dayNumber: 1,
      dayKey: "2026-09-28",
    });
    expect(await db.assign("b")).toEqual({
      dayNumber: 2,
      dayKey: "2026-09-28",
    });
    expect(db.counter("2026-09-28")).toBe(3);
  });

  it("never renumbers an order", async () => {
    const db = fakeDb({ a: { createdAt: T } });
    await db.assign("a");
    expect(await db.assign("a")).toBeNull();
    expect(db.order("a")?.dayNumber).toBe(1);
    expect(db.counter("2026-09-28")).toBe(2);
  });

  it("leaves an order waiting for the counter until it is accepted", async () => {
    const db = fakeDb({
      guest: { createdAt: T, status: "pending" },
      table: { createdAt: T + 1, status: "preparing" },
    });
    expect(await db.assign("guest")).toBeNull();
    expect(db.order("guest")?.dayNumber).toBeUndefined();
    expect(db.counter("2026-09-28")).toBeUndefined();
    // The open table's order, placed after it, is numbered first.
    expect(await db.assign("table")).toMatchObject({ dayNumber: 1 });
    db.setStatus("guest", "preparing"); // Accept
    expect(await db.assign("guest")).toMatchObject({ dayNumber: 2 });
    expect(db.commits()).toBe(2);
  });

  it("does nothing for an order that is gone", async () => {
    const db = fakeDb({});
    expect(await db.assign("nope")).toBeNull();
  });

  it("files a 23:59:59 order under its own day, even if numbered after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-28T18:31:00Z")); // 00:01 IST, the 29th
    try {
      const late = Date.parse("2026-09-28T18:29:59Z"); // 23:59:59 IST, the 28th
      const db = fakeDb({
        late: { createdAt: late },
        next: { createdAt: Date.now() },
      });
      expect(await db.assign("late")).toEqual({
        dayNumber: 1,
        dayKey: "2026-09-28",
      });
      expect(await db.assign("next")).toEqual({
        dayNumber: 1,
        dayKey: "2026-09-29",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to go past 9999", async () => {
    const tx: DayNumberTx = {
      readOrder: async () => ({ createdAt: T }),
      readCounter: async () => 10000,
      write: vi.fn(),
    };
    await expect(assignInTransaction(tx, "a")).rejects.toBeInstanceOf(
      DayNumbersExhausted,
    );
    expect(tx.write).not.toHaveBeenCalled();
  });
});

describe("two boards at once", () => {
  it("numbering the same order: one wins, the other stops", async () => {
    const db = fakeDb({ a: { createdAt: T } });
    const results = await Promise.all([db.assign("a"), db.assign("a")]);
    expect(results.filter((r) => r !== null)).toEqual([
      { dayNumber: 1, dayKey: "2026-09-28" },
    ]);
    expect(db.counter("2026-09-28")).toBe(2);
    expect(db.commits()).toBe(1);
  });

  it("numbering different orders: every number is handed out once", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `o${i}`);
    const db = fakeDb(
      Object.fromEntries(ids.map((id, i) => [id, { createdAt: T + i }])),
    );
    // Two boards each work through the whole list, as they would live.
    await Promise.all([
      (async () => {
        for (const id of ids) await db.assign(id);
      })(),
      (async () => {
        for (const id of ids) await db.assign(id);
      })(),
    ]);
    const numbers = ids.map((id) => db.order(id)?.dayNumber);
    expect(new Set(numbers).size).toBe(ids.length);
    expect([...numbers].sort((a, b) => Number(a) - Number(b))).toEqual(
      ids.map((_, i) => i + 1),
    );
    // Oldest first on both boards, so the numbers follow arrival.
    expect(numbers).toEqual(ids.map((_, i) => i + 1));
    expect(db.counter("2026-09-28")).toBe(ids.length + 1);
  });
});

// --- the board's assigner ----------------------------------------------------

function manualTimers() {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  return {
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms };
      queue.push(t);
      return t;
    },
    clearTimer: (h: unknown) => {
      const i = queue.indexOf(h as (typeof queue)[number]);
      if (i >= 0) queue.splice(i, 1);
    },
    queue,
    fire() {
      const t = queue.shift();
      t?.fn();
      return t?.ms;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createDayNumberAssigner", () => {
  it("numbers oldest first, one at a time", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let most = 0;
    const assigner = createDayNumberAssigner({
      assign: async (id) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        calls.push(id);
        await flush();
        inFlight -= 1;
      },
    });
    assigner.update([
      { id: "c", createdAt: 30 },
      { id: "a", createdAt: 10 },
      { id: "done", createdAt: 5, dayNumber: 1 },
      { id: "b", createdAt: 20 },
    ]);
    for (let i = 0; i < 10; i += 1) await flush();
    expect(calls).toEqual(["a", "b", "c"]);
    expect(most).toBe(1);
  });

  it("skips a new guest's order until it is accepted, then numbers it", async () => {
    const calls: string[] = [];
    const assigner = createDayNumberAssigner({
      assign: async (id) => {
        calls.push(id);
      },
    });
    assigner.update([
      { id: "guest", createdAt: 10, status: "pending" },
      { id: "table", createdAt: 20, status: "preparing" },
    ]);
    for (let i = 0; i < 5; i += 1) await flush();
    expect(calls).toEqual(["table"]);
    // Accepted: the next snapshot shows it preparing, still unnumbered.
    assigner.update([
      { id: "guest", createdAt: 10, status: "preparing" },
      { id: "table", createdAt: 20, status: "preparing", dayNumber: 1 },
    ]);
    for (let i = 0; i < 5; i += 1) await flush();
    expect(calls).toEqual(["table", "guest"]);
  });

  it("does not re-run an order while the live list catches up", async () => {
    const assign = vi.fn().mockResolvedValue(null);
    const assigner = createDayNumberAssigner({ assign });
    const list = [{ id: "a", createdAt: 1 }];
    assigner.update(list);
    await flush();
    assigner.update(list); // the snapshot still shows it unnumbered
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("stops for good after repeated permission errors, and says so", async () => {
    const onStall = vi.fn();
    const assign = vi.fn().mockRejectedValue(
      Object.assign(new Error("Missing or insufficient permissions."), {
        code: "permission-denied",
      }),
    );
    const timers = manualTimers();
    const assigner = createDayNumberAssigner({
      assign,
      onStall,
      ...timers,
      permissionTries: 3,
    });
    const list = [
      { id: "a", createdAt: 1 },
      { id: "b", createdAt: 2 },
    ];
    assigner.update(list);
    await flush();
    timers.fire();
    await flush();
    timers.fire();
    await flush();
    expect(assign).toHaveBeenCalledTimes(3);
    // Stopped: no retry queued, and new snapshots do not start it again.
    expect(timers.queue).toHaveLength(0);
    assigner.update([...list, { id: "c", createdAt: 3 }]);
    await flush();
    expect(assign).toHaveBeenCalledTimes(3);
    expect(onStall).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/permission/) }),
    );
  });

  it("recovers from a one-off refusal (a race reported as one)", async () => {
    const onStall = vi.fn();
    const assign = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("denied"), { code: "permission-denied" }),
      )
      .mockResolvedValue(null);
    const timers = manualTimers();
    const assigner = createDayNumberAssigner({ assign, onStall, ...timers });
    assigner.update([{ id: "a", createdAt: 1 }]);
    await flush();
    timers.fire();
    await flush();
    expect(assign).toHaveBeenCalledTimes(2);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("backs off on contention, and recovers", async () => {
    const onStall = vi.fn();
    const aborted = Object.assign(new Error("contention"), { code: "aborted" });
    const assign = vi
      .fn()
      .mockRejectedValueOnce(aborted)
      .mockRejectedValueOnce(aborted)
      .mockRejectedValueOnce(aborted)
      .mockResolvedValue(null);
    const timers = manualTimers();
    const assigner = createDayNumberAssigner({
      assign,
      onStall,
      ...timers,
      random: () => 0.5,
    });
    assigner.update([{ id: "a", createdAt: 1 }]);
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
    // A new snapshot during the backoff does not jump the queue.
    assigner.update([{ id: "a", createdAt: 1 }]);
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);

    const delays: Array<number | undefined> = [];
    for (let i = 0; i < 3; i += 1) {
      delays.push(timers.fire());
      await flush();
    }
    expect(delays).toEqual([500, 1000, 2000]);
    expect(assign).toHaveBeenCalledTimes(4);
    // Told after the third failure, and told again when it recovered.
    expect(onStall).toHaveBeenNthCalledWith(1, aborted);
    expect(onStall).toHaveBeenLastCalledWith(null);
  });

  it("skips an order a full day cannot number, and carries on", async () => {
    const onStall = vi.fn();
    const assign = vi.fn(async (id: string) => {
      if (id === "a") throw new DayNumbersExhausted("2026-09-28");
      return null;
    });
    const assigner = createDayNumberAssigner({ assign, onStall });
    assigner.update([
      { id: "a", createdAt: 1 },
      { id: "b", createdAt: 2 },
    ]);
    for (let i = 0; i < 5; i += 1) await flush();
    expect(assign.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(onStall).toHaveBeenCalledWith(expect.any(DayNumbersExhausted));
  });

  it("after stop(), a failure in flight neither retries nor reports", async () => {
    const onStall = vi.fn();
    let fail: (e: unknown) => void = () => {};
    const assign = vi.fn(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const timers = manualTimers();
    const assigner = createDayNumberAssigner({
      assign,
      onStall,
      ...timers,
      stallAfter: 1,
      permissionTries: 1,
    });
    assigner.update([{ id: "a", createdAt: 1 }]);
    await flush();
    assigner.stop();
    fail(Object.assign(new Error("aborted"), { code: "aborted" }));
    await flush();
    await flush();
    expect(timers.queue).toHaveLength(0);
    expect(onStall).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels a pending retry", async () => {
    const assign = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("x"), { code: "aborted" }));
    const timers = manualTimers();
    const assigner = createDayNumberAssigner({ assign, ...timers });
    assigner.update([{ id: "a", createdAt: 1 }]);
    await flush();
    expect(timers.queue).toHaveLength(1);
    assigner.stop();
    expect(timers.queue).toHaveLength(0);
  });
});
