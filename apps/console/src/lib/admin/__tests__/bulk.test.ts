/**
 * Maintenance on several cafes (#78): one request per cafe in a batch,
 * resumable when the page stopped partway, and revertable.
 */

import { newCafeSettings } from "@cafemenu/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { BackendRequest, Cafe } from "../../platform/model";
import { EMPTY_MAINTENANCE } from "../actions";
import {
  BULK_STORAGE_KEY,
  bulkStatus,
  forgetPlan,
  isFinishedBatch,
  loadPlans,
  newBatchId,
  revertPlan,
  runBulk,
  savePlan,
  toResume,
  type BulkPlan,
} from "../bulk";
import { requestParamsProblem } from "@cafemenu/shared/requests";

const NOW = Date.UTC(2026, 9, 27, 4, 30);

const cafe = (id: string, timeZone = "Asia/Kolkata"): Cafe => ({
  id,
  ownerUid: `u-${id}`,
  ownerEmail: `${id}@owner.test`,
  projectId: `${id}-1a2b`,
  site: id,
  region: "asia-south1",
  settings: { ...newCafeSettings({ name: id }), timeZone },
  release: {
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: null,
  },
  status: "live",
  createdAt: 1,
  updatedAt: 1,
});

const cafes = new Map(
  [cafe("a"), cafe("b", "Europe/London"), cafe("c")].map((c) => [c.id, c]),
);

const plan: BulkPlan = {
  batch: "batch-x",
  kind: "maintenance-on",
  cafeIds: ["a", "b", "c"],
  form: {
    ...EMPTY_MAINTENANCE,
    reason: "migration",
    startsAt: "2026-10-28T02:00",
  },
  startedAt: NOW,
};

const request = (
  cafeId: string,
  status: BackendRequest["status"],
  createdAt = NOW,
  batch = "batch-x",
): BackendRequest => ({
  id: `r-${cafeId}-${createdAt}`,
  cafeId,
  kind: "maintenance-on",
  params: { batch },
  status,
  by: "admin",
  createdAt,
  progress: null,
  result: null,
  error: null,
  errorCode: null,
  deploymentId: null,
  notBefore: null,
  finishedAt: null,
});

beforeEach(() => localStorage.clear());

describe("a batch", () => {
  it("has an id the request check accepts", () => {
    const batch = newBatchId(NOW);
    expect(
      requestParamsProblem("maintenance-off", { note: "", batch }),
    ).toBeNull();
  });

  it("asks for each cafe, the times read on each cafe's own clock", async () => {
    const asked: Array<{ cafeId: string; params: Record<string, unknown> }> =
      [];
    const skipped = await runBulk(
      plan,
      plan.cafeIds,
      cafes,
      async (input) => {
        asked.push(input);
        return `r${asked.length}`;
      },
      () => NOW,
    );
    expect(skipped).toEqual([]);
    expect(asked.map((a) => a.cafeId)).toEqual(["a", "b", "c"]);
    // 02:00 in Kolkata, and 02:00 in London.
    expect(asked[0].params.startsAt).toEqual(
      new Date(Date.UTC(2026, 9, 27, 20, 30)),
    );
    expect(asked[1].params.startsAt).toEqual(
      new Date(Date.UTC(2026, 9, 28, 2, 0)),
    );
    for (const a of asked) {
      expect(a.params.batch).toBe("batch-x");
      expect(requestParamsProblem("maintenance-on", a.params)).toBeNull();
    }
  });

  it("goes on past a cafe it can't ask for, and says why", async () => {
    let calls = 0;
    const skipped = await runBulk(
      plan,
      ["a", "gone", "b"],
      cafes,
      async ({ cafeId }) => {
        calls += 1;
        if (cafeId === "b") throw new Error("permission-denied");
        return "r";
      },
      () => NOW,
    );
    expect(calls).toBe(2);
    expect(skipped.map((s) => s.cafeId)).toEqual(["gone", "b"]);
  });
});

describe("resuming and reverting", () => {
  it("knows which cafes are done, waiting, failed and never asked", () => {
    const status = bulkStatus(plan, [
      request("a", "done"),
      request("b", "failed", NOW),
      request("b", "queued", NOW - 1),
      request("c", "done", NOW, "another-batch"),
    ]);
    expect(status).toEqual({
      done: ["a"],
      failed: ["b"],
      waiting: [],
      notAsked: ["c"],
    });
    expect(toResume(status)).toEqual(["c", "b"]);
    expect(isFinishedBatch(status)).toBe(false);
  });

  it("finishes when every cafe is answered", () => {
    const status = bulkStatus(plan, [
      request("a", "done"),
      request("b", "done"),
      request("c", "done"),
    ]);
    expect(isFinishedBatch(status)).toBe(true);
    expect(toResume(status)).toEqual([]);
  });

  it("reverts as a batch of its own: off where it turned maintenance on", () => {
    const status = bulkStatus(plan, [
      request("a", "done"),
      request("b", "queued"),
      request("c", "failed"),
    ]);
    const revert = revertPlan(plan, status, NOW + 1, "Reverting.");
    expect(revert?.kind).toBe("maintenance-off");
    expect(revert?.cafeIds).toEqual(["a", "b"]);
    expect(revert?.batch).not.toBe(plan.batch);
    expect(
      revertPlan({ ...plan, kind: "maintenance-off" }, status, NOW, ""),
    ).toBeNull();
  });
});

describe("kept in this browser", () => {
  it("saves, lists newest first, and forgets", () => {
    savePlan(plan, NOW);
    savePlan({ ...plan, batch: "batch-y", startedAt: NOW + 5 }, NOW);
    expect(loadPlans(NOW).map((p) => p.batch)).toEqual(["batch-y", "batch-x"]);
    forgetPlan("batch-y", NOW);
    expect(loadPlans(NOW).map((p) => p.batch)).toEqual(["batch-x"]);
  });

  it("drops what isn't a plan, and plans older than two weeks", () => {
    localStorage.setItem(
      BULK_STORAGE_KEY,
      JSON.stringify([plan, { batch: 3 }, "junk"]),
    );
    expect(loadPlans(NOW)).toHaveLength(1);
    expect(loadPlans(NOW + 15 * 24 * 3600_000)).toEqual([]);
    localStorage.setItem(BULK_STORAGE_KEY, "{not json");
    expect(loadPlans(NOW)).toEqual([]);
  });
});
