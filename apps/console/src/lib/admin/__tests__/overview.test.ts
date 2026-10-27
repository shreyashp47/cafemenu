import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import type { Cafe, Deployment } from "../../platform/model";
import {
  adminRows,
  auditRows,
  byCafe,
  cafeHealth,
  filterRows,
  followOf,
  rolloutButton,
  smokeOf,
  summary,
} from "../overview";

const cafe = (id: string, over: Partial<Cafe> = {}): Cafe => ({
  id,
  ownerUid: `u-${id}`,
  ownerEmail: `${id}@owner.test`,
  projectId: `${id}-1a2b`,
  site: id,
  region: "nam5",
  settings: newCafeSettings({ name: `Cafe ${id}` }),
  release: {
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: null,
  },
  status: "live",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const steps = (smoke: "done" | "failed" | "pending" | null) => [
  { id: "hosting", label: "Hosting", status: "done" as const },
  ...(smoke ? [{ id: "smoke", label: "Smoke test", status: smoke }] : []),
];

const deployment = (
  id: string,
  cafeId: string,
  over: Partial<Deployment> = {},
): Deployment => ({
  id,
  cafeId,
  ownerUid: `u-${cafeId}`,
  kind: "deploy",
  version: "1.1.1",
  fromVersion: "1.1.0",
  status: "succeeded",
  trigger: "rollout",
  steps: steps("done"),
  error: null,
  createdAt: 100,
  finishedAt: 150,
  ...over,
});

describe("the smoke test of a deployment", () => {
  it("is what its smoke step says", () => {
    expect(smokeOf(deployment("d", "a"))).toBe("passed");
    expect(smokeOf(deployment("d", "a", { steps: steps("failed") }))).toBe(
      "failed",
    );
    expect(smokeOf(deployment("d", "a", { steps: steps("pending") }))).toBe(
      "not-run",
    );
  });

  it("is nothing for a deployment that has none", () => {
    expect(smokeOf(deployment("d", "a", { steps: steps(null) }))).toBeNull();
    expect(smokeOf(deployment("d", "a", { steps: [] }))).toBeNull();
  });
});

describe("how a cafe is doing", () => {
  it("is ok when its latest deployment went through", () => {
    expect(cafeHealth(cafe("a"), deployment("d", "a"))).toEqual({
      level: "ok",
      reason: "healthy",
      error: null,
    });
  });

  it("is busy while something is queued or running", () => {
    for (const status of ["queued", "running"] as const) {
      expect(
        cafeHealth(cafe("a"), deployment("d", "a", { status })),
      ).toMatchObject({ level: "busy", reason: "running" });
    }
    expect(
      cafeHealth(cafe("a", { status: "provisioning" }), null),
    ).toMatchObject({ level: "busy", reason: "provisioning" });
  });

  it("needs a look after a failed or rolled-back deployment, with its error", () => {
    expect(
      cafeHealth(
        cafe("a"),
        deployment("d", "a", { status: "failed", error: "No access." }),
      ),
    ).toEqual({ level: "attention", reason: "failed", error: "No access." });
    expect(
      cafeHealth(
        cafe("a"),
        deployment("d", "a", {
          status: "rolled-back",
          error: "The smoke test failed.",
        }),
      ),
    ).toEqual({
      level: "attention",
      reason: "rolled-back",
      error: "The smoke test failed.",
    });
  });

  it("goes by the cafe's own status before its deployments", () => {
    const ok = deployment("d", "a");
    expect(cafeHealth(cafe("a", { status: "draft" }), null)).toMatchObject({
      level: "not-live",
      reason: "draft",
    });
    expect(cafeHealth(cafe("a", { status: "disconnected" }), ok)).toMatchObject(
      { level: "attention", reason: "disconnected" },
    );
    expect(cafeHealth(cafe("a", { status: "failed" }), ok)).toMatchObject({
      level: "attention",
      reason: "setup-failed",
    });
    expect(cafeHealth(cafe("a", { status: "suspended" }), ok)).toMatchObject({
      level: "paused",
      reason: "suspended",
    });
  });

  it("is unknown for a live cafe with no deployment on record", () => {
    expect(cafeHealth(cafe("a"), null)).toEqual({
      level: "unknown",
      reason: "no-deploys",
      error: null,
    });
  });
});

describe("one row per cafe", () => {
  const cafes = [
    cafe("a"),
    cafe("b"),
    cafe("c"),
    cafe("d", { status: "draft" }),
  ];
  const deployments = [
    deployment("a1", "a", { createdAt: 300 }),
    deployment("a0", "a", { createdAt: 100, steps: steps("failed") }),
    deployment("b1", "b", {
      createdAt: 200,
      status: "rolled-back",
      error: "x",
      steps: steps("failed"),
    }),
    deployment("c1", "c", {
      createdAt: 250,
      kind: "branding",
      steps: steps(null),
    }),
    deployment("c0", "c", { createdAt: 50 }),
  ];
  const rows = adminRows(cafes, deployments);

  it("groups deployments by cafe, newest first", () => {
    const grouped = byCafe(deployments);
    expect(grouped.get("a")?.map((d) => d.id)).toEqual(["a1", "a0"]);
    expect(grouped.get("d")).toBeUndefined();
  });

  it("puts the cafes that need a look first, then by name", () => {
    expect(rows.map((r) => r.cafe.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("reads each cafe's latest deployment and its last smoke test", () => {
    const byId = Object.fromEntries(rows.map((r) => [r.cafe.id, r]));
    expect(byId.a.last?.id).toBe("a1");
    expect(byId.a.smoke).toEqual({ result: "passed", at: 300 });
    expect(byId.b.smoke).toEqual({ result: "failed", at: 200 });
    // The newest deployment of c is a branding sync with no smoke test: the
    // smoke result is the one before it.
    expect(byId.c.last?.kind).toBe("branding");
    expect(byId.c.smoke).toEqual({ result: "passed", at: 50 });
    expect(byId.d.last).toBeNull();
    expect(byId.d.smoke).toBeNull();
  });

  it("counts them", () => {
    expect(summary(rows)).toEqual({ total: 4, live: 3, attention: 1, busy: 0 });
  });
});

describe("filters", () => {
  const rows = adminRows(
    [
      cafe("a", {
        release: {
          channel: "beta",
          pinned: null,
          current: "1.2.0-beta.1",
          previous: null,
        },
      }),
      cafe("b", {
        release: {
          channel: "stable",
          pinned: "1.0",
          current: "1.0.0",
          previous: null,
        },
      }),
      cafe("c", { ownerEmail: "sam@owner.test", site: "tea-room" }),
    ],
    [deployment("c1", "c", { status: "failed", error: "x" })],
  );

  it("picks by how the cafe is doing and how it follows releases", () => {
    const ids = (filter: Parameters<typeof filterRows>[1]) =>
      filterRows(rows, filter, "")
        .map((r) => r.cafe.id)
        .sort();
    expect(ids("all")).toEqual(["a", "b", "c"]);
    expect(ids("attention")).toEqual(["c"]);
    expect(ids("busy")).toEqual([]);
    expect(ids("beta")).toEqual(["a"]);
    expect(ids("pinned")).toEqual(["b"]);
  });

  it("searches name, address and owner, ignoring case and spaces", () => {
    const ids = (q: string) => filterRows(rows, "all", q).map((r) => r.cafe.id);
    expect(ids(" CAFE b ")).toEqual(["b"]);
    expect(ids("tea-room")).toEqual(["c"]);
    expect(ids("SAM@")).toEqual(["c"]);
    expect(ids("nothing")).toEqual([]);
  });

  it("names how a cafe follows releases", () => {
    expect(
      followOf({
        channel: "beta",
        pinned: null,
        current: null,
        previous: null,
      }),
    ).toEqual({ kind: "beta", line: null });
    expect(
      followOf({
        channel: "stable",
        pinned: "1.4",
        current: null,
        previous: null,
      }),
    ).toEqual({ kind: "pinned", line: "1.4" });
    expect(
      followOf({
        channel: "beta",
        pinned: "1.4",
        current: null,
        previous: null,
      }).kind,
    ).toBe("pinned");
  });
});

describe("the audit list", () => {
  const cafes = [cafe("a"), cafe("b")];
  const list = [
    deployment("d3", "a", {
      trigger: "owner",
      kind: "rollback",
      version: "1.1.0",
    }),
    deployment("d2", "b", { status: "rolled-back", error: "x" }),
    deployment("d1", "gone", { trigger: "admin" }),
  ];

  it("says who asked, and which cafe", () => {
    const rows = auditRows(list, cafes);
    expect(rows.map((r) => r.cafeName)).toEqual(["Cafe a", "Cafe b", "gone"]);
    expect(rows[0].who).toEqual({ kind: "owner", email: "a@owner.test" });
    expect(rows[1].who).toEqual({ kind: "rollout" });
    expect(rows[2].who).toEqual({ kind: "admin" });
  });

  it("filters to one cafe, or to what did not go through", () => {
    expect(
      auditRows(list, cafes, { cafeId: "a", problemsOnly: false }).map(
        (r) => r.deployment.id,
      ),
    ).toEqual(["d3"]);
    expect(
      auditRows(list, cafes, { cafeId: null, problemsOnly: true }).map(
        (r) => r.deployment.id,
      ),
    ).toEqual(["d2"]);
  });
});

describe("a rollout's button", () => {
  it("starts one that has not begun, pauses a running one, resumes a paused one", () => {
    expect(rolloutButton(undefined)).toBe("start");
    expect(rolloutButton("running")).toBe("pause");
    expect(rolloutButton("paused")).toBe("resume");
    expect(rolloutButton("completed")).toBeNull();
  });
});
