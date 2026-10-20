/**
 * `npm run cleanup:orders` (issue #31): the date maths, the argument rules that
 * keep it a dry run by default and refuse to break the six-month minimum, and
 * the delete loop, against a fake client. Nothing here touches a real project.
 */
import { describe, expect, it } from "vitest";

import { UsageError } from "../lib/admin-client.mjs";
import {
  BATCH,
  cutoffFor,
  parseAge,
  parseCleanupArgs,
  runCleanup,
  subtractMonths,
} from "../lib/cleanup-orders.mjs";

const at = (iso) => new Date(iso);

describe("parseAge", () => {
  it.each([
    ["6m", { amount: 6, unit: "m" }],
    ["1y", { amount: 1, unit: "y" }],
    ["200d", { amount: 200, unit: "d" }],
    [" 12m ", { amount: 12, unit: "m" }],
  ])("%s", (input, expected) => {
    expect(parseAge(input)).toEqual(expected);
  });

  it.each(["", "6", "m", "6 months", "0m", "-6m", "6w", "1.5y"])(
    "rejects %j",
    (input) => {
      expect(() => parseAge(input)).toThrow(UsageError);
    },
  );
});

describe("subtractMonths", () => {
  it("moves by calendar months, keeping the time of day", () => {
    expect(subtractMonths(at("2026-09-27T10:30:00Z"), 6)).toEqual(
      at("2026-03-27T10:30:00Z"),
    );
  });

  it("clamps to the end of a shorter month instead of spilling over", () => {
    expect(subtractMonths(at("2026-08-31T00:00:00Z"), 6)).toEqual(
      at("2026-02-28T00:00:00Z"),
    );
    // leap year
    expect(subtractMonths(at("2024-08-31T00:00:00Z"), 6)).toEqual(
      at("2024-02-29T00:00:00Z"),
    );
  });

  it("crosses a year boundary", () => {
    expect(subtractMonths(at("2026-03-15T00:00:00Z"), 6)).toEqual(
      at("2025-09-15T00:00:00Z"),
    );
    expect(subtractMonths(at("2026-03-15T00:00:00Z"), 24)).toEqual(
      at("2024-03-15T00:00:00Z"),
    );
  });
});

describe("cutoffFor", () => {
  const now = at("2026-09-27T12:00:00Z");
  it("handles months, years and days", () => {
    expect(cutoffFor({ amount: 6, unit: "m" }, now)).toEqual(
      at("2026-03-27T12:00:00Z"),
    );
    expect(cutoffFor({ amount: 1, unit: "y" }, now)).toEqual(
      at("2025-09-27T12:00:00Z"),
    );
    expect(cutoffFor({ amount: 200, unit: "d" }, now)).toEqual(
      at("2026-03-11T12:00:00Z"),
    );
  });
});

describe("parseCleanupArgs", () => {
  const now = at("2026-09-27T12:00:00Z");

  it("defaults to a six-month dry run", () => {
    expect(parseCleanupArgs([], now)).toEqual({
      help: false,
      olderThan: "6m",
      cutoff: at("2026-03-27T12:00:00Z"),
      confirm: false,
      project: undefined,
    });
  });

  it("only deletes with an explicit --confirm", () => {
    expect(parseCleanupArgs(["--older-than=1y"], now).confirm).toBe(false);
    expect(parseCleanupArgs(["--dry-run"], now).confirm).toBe(false);
    expect(
      parseCleanupArgs(["--older-than=1y", "--confirm"], now).confirm,
    ).toBe(true);
  });

  it("refuses anything that would delete an order under six months old", () => {
    for (const age of ["5m", "1m", "180d", "3d"]) {
      expect(() => parseCleanupArgs([`--older-than=${age}`], now)).toThrow(
        /at least 6 months/,
      );
    }
    // 184 days back from 27 Sept reaches past 27 March, so it is allowed.
    expect(() => parseCleanupArgs(["--older-than=184d"], now)).not.toThrow();
  });

  it("rejects contradictions and typos", () => {
    expect(() => parseCleanupArgs(["--confirm", "--dry-run"], now)).toThrow(
      /contradict/,
    );
    expect(() => parseCleanupArgs(["--older=6m"], now)).toThrow(UsageError);
    expect(() => parseCleanupArgs(["--older-than=six"], now)).toThrow(
      UsageError,
    );
  });

  it("returns help on its own", () => {
    expect(parseCleanupArgs(["--help"], now)).toEqual({ help: true });
  });
});

/** An in-memory order collection that behaves like the admin client. */
function fakeClient(
  ages,
  { now = at("2026-09-27T12:00:00Z"), stuck = false } = {},
) {
  let docs = ages.map((days, i) => ({
    name: `orders/o${i}`,
    createdAt: new Date(now.getTime() - days * 86_400_000),
  }));
  const deleteCalls = [];
  const before = (cutoff) =>
    docs
      .filter((d) => d.createdAt < cutoff)
      .sort((a, b) => a.createdAt - b.createdAt);
  return {
    target: "a fake project",
    deleteCalls,
    remaining: () => docs.length,
    async countOrdersBefore(cutoff) {
      return before(cutoff).length;
    },
    async listOrdersBefore(cutoff, limit) {
      return before(cutoff).slice(0, limit);
    },
    async deleteDocuments(names) {
      deleteCalls.push(names.length);
      if (stuck) return;
      docs = docs.filter((d) => !names.includes(d.name));
    },
  };
}

describe("runCleanup", () => {
  const now = at("2026-09-27T12:00:00Z");
  const old = Array.from({ length: 650 }, (_, i) => 200 + (i % 300));
  const recent = [1, 30, 90, 170];

  it("a dry run counts and deletes nothing", async () => {
    const client = fakeClient([...old, ...recent]);
    const lines = [];
    const result = await runCleanup(parseCleanupArgs([], now), client, (l) =>
      lines.push(l),
    );
    expect(result).toEqual({ found: 650, deleted: 0 });
    expect(client.deleteCalls).toEqual([]);
    expect(client.remaining()).toBe(654);
    expect(lines.join("\n")).toMatch(/\[dry run\].*650/);
    expect(lines.join("\n")).toMatch(/nothing was deleted/);
  });

  it("--confirm deletes exactly the old ones, in batches", async () => {
    const client = fakeClient([...old, ...recent]);
    const result = await runCleanup(
      parseCleanupArgs(["--confirm"], now),
      client,
      () => {},
    );
    expect(result).toEqual({ found: 650, deleted: 650 });
    expect(client.remaining()).toBe(recent.length);
    expect(client.deleteCalls).toEqual([BATCH, BATCH, 650 - 2 * BATCH]);
  });

  it("says so and stops when there is nothing to delete", async () => {
    const client = fakeClient(recent);
    const result = await runCleanup(
      parseCleanupArgs(["--confirm"], now),
      client,
      () => {},
    );
    expect(result).toEqual({ found: 0, deleted: 0 });
    expect(client.deleteCalls).toEqual([]);
  });

  it("stops instead of looping forever if deletes do not land", async () => {
    const client = fakeClient(old, { stuck: true });
    await expect(
      runCleanup(parseCleanupArgs(["--confirm"], now), client, () => {}),
    ).rejects.toThrow(/not taking effect/);
    expect(client.deleteCalls).toHaveLength(1);
  });
});
