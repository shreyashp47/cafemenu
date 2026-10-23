import { DEFAULT_SETTINGS, newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import {
  compareVersionsDesc,
  parseCafe,
  parseDeployment,
  parseRelease,
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
