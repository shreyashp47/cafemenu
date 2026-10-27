import { DEFAULT_SETTINGS, newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import {
  compareVersionsDesc,
  parseCafe,
  parseDeployment,
  parseRelease,
  parseAdminLogEntry,
  parseCafeMaintenance,
  parseOwnerRecord,
  parseRequest,
  parseSentEmail,
  toMillis,
} from "../parse";
import { newCafeRecord } from "../records";

const stamp = (ms: number) => ({ toMillis: () => ms });

describe("toMillis", () => {
  it("reads Timestamps, Dates and numbers", () => {
    expect(toMillis(stamp(5))).toBe(5);
    expect(toMillis(new Date(7))).toBe(7);
    expect(toMillis(9)).toBe(9);
  });
  it("uses the fallback for a pending server timestamp", () => {
    expect(toMillis(null, 3)).toBe(3);
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis(Number.NaN, 1)).toBe(1);
  });
});

describe("parseCafe", () => {
  const record = newCafeRecord(
    { uid: "u1", email: "owner@cafe.test" },
    {
      site: "toe-cafe",
      region: "asia-south1",
      settings: newCafeSettings({ name: "TOE" }),
    },
    stamp(1000),
  );

  it("reads what the console writes", () => {
    expect(parseCafe("c1", record)).toEqual({
      id: "c1",
      ownerUid: "u1",
      ownerEmail: "owner@cafe.test",
      projectId: null,
      site: "toe-cafe",
      region: "asia-south1",
      settings: newCafeSettings({ name: "TOE" }),
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
      },
      status: "draft",
      statusReason: null,
      statusChangedAt: null,
      maintenance: null,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("reads what the backend writes later", () => {
    const cafe = parseCafe("c1", {
      ...record,
      projectId: "toi-cafe",
      status: "live",
      release: {
        channel: "beta",
        pinned: "1.4",
        current: "1.4.2",
        previous: "1.4.1",
      },
    });
    expect(cafe?.status).toBe("live");
    expect(cafe?.release).toEqual({
      channel: "beta",
      pinned: "1.4",
      current: "1.4.2",
      previous: "1.4.1",
    });
  });

  it("reads settings as the cafe app does: a bad field is its default", () => {
    const cafe = parseCafe("c1", {
      ...record,
      settings: { ...record.settings, name: "", currency: "EUR" },
    });
    expect(cafe?.settings).toMatchObject({
      name: DEFAULT_SETTINGS.name,
      currency: "EUR",
    });
    expect(parseCafe("c1", { ...record, settings: "x" })?.settings).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("drops a record missing what every cafe has", () => {
    expect(parseCafe("c1", { ...record, ownerUid: 7 })).toBeNull();
    expect(parseCafe("c1", { ...record, status: "gone" })).toBeNull();
    expect(parseCafe("c1", { ...record, release: null })).toBeNull();
    expect(parseCafe("c1", "nope")).toBeNull();
  });

  it("does not trust a malformed version or pin", () => {
    const cafe = parseCafe("c1", {
      ...record,
      release: {
        channel: "stable",
        pinned: "x",
        current: "latest",
        previous: 3,
      },
    });
    expect(cafe?.release).toEqual({
      channel: "stable",
      pinned: null,
      current: null,
      previous: null,
    });
  });
});

describe("parseRelease", () => {
  const data = {
    channel: "stable",
    notes: "Fixes.",
    publishedAt: stamp(5),
    schemaVersion: 2,
    withdrawn: false,
  };
  it("reads a release, keyed by its version", () => {
    expect(parseRelease("1.4.2", data)).toEqual({
      version: "1.4.2",
      channel: "stable",
      notes: "Fixes.",
      publishedAt: 5,
      schemaVersion: 2,
      withdrawn: false,
    });
  });
  it("drops a release with a bad id, channel or date", () => {
    expect(parseRelease("latest", data)).toBeNull();
    expect(parseRelease("1.4.2", { ...data, channel: "nightly" })).toBeNull();
    expect(parseRelease("1.4.2", { ...data, publishedAt: "soon" })).toBeNull();
  });
});

describe("parseDeployment", () => {
  const data = {
    cafeId: "c1",
    ownerUid: "u1",
    kind: "deploy",
    version: "1.4.2",
    fromVersion: "1.4.1",
    status: "succeeded",
    trigger: "rollout",
    steps: [
      { id: "rules", label: "Deploy the rules", status: "done" },
      { id: "broken" },
    ],
    error: null,
    createdAt: stamp(10),
    finishedAt: stamp(20),
  };
  it("reads a deployment and keeps only well-formed steps", () => {
    expect(parseDeployment("d1", data)).toEqual({
      id: "d1",
      cafeId: "c1",
      ownerUid: "u1",
      kind: "deploy",
      version: "1.4.2",
      fromVersion: "1.4.1",
      status: "succeeded",
      trigger: "rollout",
      steps: [{ id: "rules", label: "Deploy the rules", status: "done" }],
      error: null,
      createdAt: 10,
      finishedAt: 20,
    });
  });
  it("drops a deployment of an unknown kind or status", () => {
    expect(parseDeployment("d1", { ...data, kind: "nuke" })).toBeNull();
    expect(parseDeployment("d1", { ...data, status: "done" })).toBeNull();
    expect(parseDeployment("d1", { ...data, createdAt: null })).toBeNull();
  });
});

describe("compareVersionsDesc", () => {
  it("sorts by semantic version, not as text", () => {
    expect(
      [
        "1.2.0",
        "1.10.0",
        "1.9.3",
        "2.0.0",
        "1.10.0-beta.2",
        "1.10.0-beta.10",
      ].sort(compareVersionsDesc),
    ).toEqual([
      "2.0.0",
      "1.10.0",
      "1.10.0-beta.10",
      "1.10.0-beta.2",
      "1.9.3",
      "1.2.0",
    ]);
  });
});

describe("parseRequest", () => {
  const record = {
    cafeId: "c1",
    kind: "deploy",
    params: { version: "1.2.0" },
    status: "running",
    createdAt: stamp(5),
    by: "u1",
    progress: {
      steps: [
        { id: "rules", label: "Firestore rules", status: "done" },
        { id: "hosting", label: "Hosting", status: "running" },
        { nonsense: true },
      ],
      detail: "Hosting",
    },
    deploymentId: "d1",
  };

  it("reads what the console wrote and what the backend answered", () => {
    expect(parseRequest("r1", record)).toEqual({
      id: "r1",
      cafeId: "c1",
      kind: "deploy",
      params: { version: "1.2.0" },
      status: "running",
      by: "u1",
      createdAt: 5,
      progress: {
        steps: [
          { id: "rules", label: "Firestore rules", status: "done" },
          { id: "hosting", label: "Hosting", status: "running" },
        ],
        detail: "Hosting",
      },
      result: null,
      error: null,
      errorCode: null,
      deploymentId: "d1",
      notBefore: null,
      finishedAt: null,
    });
  });

  it("reads an admin request about an account, with no cafe, and one waiting for its date", () => {
    expect(
      parseRequest("r2", {
        ...record,
        cafeId: null,
        kind: "appoint-admin",
        params: { email: "erin@x.test", note: "" },
      })?.cafeId,
    ).toBeNull();
    expect(
      parseRequest("r3", { ...record, kind: "suspend", notBefore: stamp(9) })
        ?.notBefore,
    ).toBe(9);
    expect(parseRequest("r4", { ...record, cafeId: 7 })).toBeNull();
  });

  it("reads a request just written, before the server's time is back, as now", () => {
    const parsed = parseRequest("r1", { ...record, createdAt: null });
    expect(parsed?.createdAt).toBeGreaterThan(0);
  });

  it("drops what isn't a request", () => {
    expect(parseRequest("r1", { ...record, kind: "format-disk" })).toBeNull();
    expect(parseRequest("r1", { ...record, status: "maybe" })).toBeNull();
    expect(parseRequest("r1", { ...record, by: 3 })).toBeNull();
    expect(parseRequest("r1", null)).toBeNull();
    expect(parseRequest("r1", { ...record, progress: "lots" })?.progress).toBe(
      null,
    );
  });
});

describe("the super admin's records (#78)", () => {
  it("reads a cafe the admin suspended and put into maintenance", () => {
    const record = newCafeRecord(
      { uid: "u1", email: "owner@cafe.test" },
      {
        site: "toe-cafe",
        region: "asia-south1",
        settings: newCafeSettings({ name: "TOE" }),
      },
      stamp(1000),
    );
    const cafe = parseCafe("c1", {
      ...record,
      status: "suspended",
      statusReason: { code: "abuse", note: "Spam orders." },
      statusChangedAt: stamp(2000),
      maintenance: {
        on: true,
        by: "admin",
        message: "Back soon.",
        until: null,
        startsAt: stamp(3000),
        endsAt: null,
        reason: { code: "migration", note: "" },
        setAt: stamp(2500),
        setBy: "admin-uid",
        batch: "batch-1",
      },
    });
    expect(cafe?.statusReason).toEqual({ code: "abuse", note: "Spam orders." });
    expect(cafe?.statusChangedAt).toBe(2000);
    expect(cafe?.maintenance).toEqual({
      on: true,
      by: "admin",
      message: "Back soon.",
      until: null,
      startsAt: 3000,
      endsAt: null,
      reason: { code: "migration", note: "" },
      setAt: 2500,
      setBy: "admin-uid",
      batch: "batch-1",
    });
  });

  it("reads maintenance that is off, or not one, as none", () => {
    expect(parseCafeMaintenance(null)).toBeNull();
    expect(parseCafeMaintenance({ on: false })).toBeNull();
    expect(parseCafeMaintenance("on")).toBeNull();
  });

  it("reads an owners directory entry, active unless it says otherwise", () => {
    expect(
      parseOwnerRecord("u1", {
        email: "owner@cafe.test",
        name: "Asha",
        createdAt: 1000,
        lastSignInAt: 5000,
        admin: false,
        disabled: false,
      }),
    ).toEqual({
      uid: "u1",
      email: "owner@cafe.test",
      name: "Asha",
      createdAt: 1000,
      lastSignInAt: 5000,
      admin: false,
      disabled: false,
      status: "active",
      statusReason: null,
      statusChangedAt: null,
    });
    expect(
      parseOwnerRecord("u1", { email: "o@x.test", status: "suspended" })
        ?.status,
    ).toBe("suspended");
    expect(parseOwnerRecord("u1", { name: "no email" })).toBeNull();
  });

  it("reads an admin log entry, and drops one with no time or action", () => {
    const entry = {
      at: stamp(10),
      by: "admin-uid",
      byEmail: "erin@x.test",
      action: "suspend",
      cafeId: "c1",
      ownerUid: "u1",
      reason: { code: "abuse", note: "" },
      details: { cafes: ["c1"] },
      requestId: "r1",
    };
    expect(parseAdminLogEntry("r1", entry)).toEqual({
      id: "r1",
      at: 10,
      by: "admin-uid",
      byEmail: "erin@x.test",
      action: "suspend",
      cafeId: "c1",
      ownerUid: "u1",
      reason: { code: "abuse", note: "" },
      details: { cafes: ["c1"] },
    });
    expect(parseAdminLogEntry("r1", { ...entry, at: null })).toBeNull();
    expect(parseAdminLogEntry("r1", { ...entry, action: 3 })).toBeNull();
  });

  it("reads a sent email", () => {
    expect(
      parseSentEmail("e1", {
        kind: "account-suspended",
        key: "k",
        at: stamp(4),
      }),
    ).toEqual({ id: "e1", kind: "account-suspended", at: 4 });
    expect(parseSentEmail("e1", { kind: "x" })).toBeNull();
  });
});
