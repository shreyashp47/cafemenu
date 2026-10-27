/**
 * The super admin's directory (#78, section 3.1): every owner and cafe, the
 * search by email, name, address and project ID, the five filters, and the
 * CSV export.
 */

import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import type {
  Cafe,
  CafeMaintenance,
  Deployment,
  OwnerRecord,
} from "../../platform/model";
import {
  NO_FILTERS,
  csvCell,
  directoryCsv,
  directoryRows,
  directorySummary,
  filterDirectory,
  maintenanceState,
  siteOf,
  type DirectoryFilters,
} from "../directory";

const NOW = Date.UTC(2026, 9, 27, 12);
const HOUR = 3600_000;

const cafe = (id: string, over: Partial<Cafe> = {}): Cafe => ({
  id,
  ownerUid: `u-${id}`,
  ownerEmail: `${id}@owner.test`,
  projectId: `${id}-1a2b`,
  site: `${id}-cafe`,
  region: "asia-south1",
  settings: newCafeSettings({ name: `Cafe ${id.toUpperCase()}` }),
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

const owner = (uid: string, over: Partial<OwnerRecord> = {}): OwnerRecord => ({
  uid,
  email: `${uid}@owner.test`,
  name: null,
  createdAt: 10,
  lastSignInAt: 20,
  admin: false,
  disabled: false,
  status: "active",
  statusReason: null,
  statusChangedAt: null,
  ...over,
});

const maintenance = (over: Partial<CafeMaintenance> = {}): CafeMaintenance => ({
  on: true,
  by: "admin",
  message: "",
  until: null,
  startsAt: null,
  endsAt: null,
  reason: { code: "migration", note: "" },
  setAt: NOW - HOUR,
  setBy: "admin",
  batch: null,
  ...over,
});

const failed: Deployment = {
  id: "d1",
  cafeId: "c",
  ownerUid: "u-c",
  kind: "deploy",
  version: "1.1.1",
  fromVersion: "1.1.0",
  status: "failed",
  trigger: "rollout",
  steps: [],
  error: "x",
  createdAt: 100,
  finishedAt: 150,
};

const cafes = [
  cafe("a", {
    release: {
      channel: "beta",
      pinned: null,
      current: "1.2.0-beta.1",
      previous: null,
    },
    maintenance: maintenance(),
  }),
  cafe("b", {
    release: {
      channel: "stable",
      pinned: "1.0",
      current: "1.0.0",
      previous: null,
    },
    status: "suspended",
    maintenance: maintenance({ startsAt: NOW + HOUR }),
  }),
  cafe("c", { projectId: "tea-room-9f3c", site: "tea-room" }),
];
const owners = [
  owner("u-a", { name: "Asha Rao", email: "asha@owner.test" }),
  owner("u-b", { status: "suspended", disabled: true }),
  owner("u-c"),
  owner("u-z", { email: "zed@owner.test" }),
];
const rows = directoryRows(cafes, owners, [failed], NOW);

describe("every owner and cafe", () => {
  it("has a row per cafe, needing a look first, then the owners with none", () => {
    expect(rows.map((r) => r.key)).toEqual(["c", "a", "b", "owner:u-z"]);
    const z = rows.at(-1);
    expect(z?.cafe).toBeNull();
    expect(z?.email).toBe("zed@owner.test");
  });

  it("joins each cafe to its owner's directory entry", () => {
    const a = rows.find((r) => r.key === "a");
    expect(a?.owner?.name).toBe("Asha Rao");
    expect(a?.email).toBe("asha@owner.test");
    // Not in the directory yet (it is copied hourly): the cafe's own email.
    const lone = directoryRows([cafe("q")], [], [], NOW)[0];
    expect(lone.owner).toBeNull();
    expect(lone.email).toBe("q@owner.test");
  });

  it("reads a suspended cafe as a suspended owner, whatever the directory has", () => {
    const row = directoryRows(
      [cafe("s", { status: "suspended" })],
      [owner("u-s")],
      [],
      NOW,
    )[0];
    expect(row.status).toBe("suspended");
  });

  it("says whether CafeMenu's maintenance is on, scheduled or off", () => {
    expect(maintenanceState(maintenance(), NOW)).toBe("on");
    expect(maintenanceState(maintenance({ startsAt: NOW + HOUR }), NOW)).toBe(
      "scheduled",
    );
    expect(maintenanceState(maintenance({ endsAt: NOW - 1 }), NOW)).toBe("off");
    expect(maintenanceState(null, NOW)).toBe("off");
  });

  it("counts them", () => {
    expect(directorySummary(rows)).toEqual({
      owners: 4,
      total: 3,
      live: 2,
      suspended: 1,
      maintenance: 1,
      attention: 1,
    });
  });
});

describe("search and filters", () => {
  const keys = (filters: Partial<DirectoryFilters>, query = "") =>
    filterDirectory(rows, { ...NO_FILTERS, ...filters }, query).map(
      (r) => r.key,
    );

  it("finds by email, owner's name, cafe's name, web address and project ID", () => {
    expect(keys({}, "ASHA@")).toEqual(["a"]);
    expect(keys({}, "asha rao")).toEqual(["a"]);
    expect(keys({}, " cafe b ")).toEqual(["b"]);
    expect(keys({}, "https://tea-room.web.app/")).toEqual(["c"]);
    expect(keys({}, "tea-room-9f3c")).toEqual(["c"]);
    expect(keys({}, "zed")).toEqual(["owner:u-z"]);
    expect(keys({}, "nothing")).toEqual([]);
  });

  it("filters by status, maintenance, plan, channel and health", () => {
    expect(keys({ status: "suspended" })).toEqual(["b"]);
    expect(keys({ status: "active" })).toEqual(["c", "a", "owner:u-z"]);
    expect(keys({ maintenance: "on" })).toEqual(["a"]);
    expect(keys({ maintenance: "scheduled" })).toEqual(["b"]);
    expect(keys({ plan: "free" })).toEqual(["c", "a", "b"]);
    expect(keys({ channel: "beta" })).toEqual(["a"]);
    expect(keys({ channel: "pinned" })).toEqual(["b"]);
    expect(keys({ channel: "stable" })).toEqual(["c"]);
    expect(keys({ health: "attention" })).toEqual(["c"]);
    expect(keys({ health: "paused" })).toEqual(["b"]);
    expect(keys({ channel: "beta", maintenance: "off" })).toEqual([]);
  });

  it("reads a web address however it was pasted", () => {
    expect(siteOf(" https://Tea-Room.web.app/order?table=2 ")).toBe("tea-room");
    expect(siteOf("tea-room.firebaseapp.com")).toBe("tea-room");
    expect(siteOf("tea-room")).toBe("tea-room");
  });
});

describe("the CSV export", () => {
  it("has a header and a line per row, with the directory's columns", () => {
    const csv = directoryCsv(rows).split("\r\n");
    expect(csv[0]).toBe(
      "owner_name,owner_email,signed_up,last_sign_in,status,cafe_name,web_address,firebase_project,cafe_status,maintenance,plan,version,channel,last_deploy,last_deploy_status,health",
    );
    expect(csv).toHaveLength(rows.length + 1);
    const a = csv.find((line) => line.includes("asha@owner.test"));
    expect(a?.split(",")).toEqual([
      "Asha Rao",
      "asha@owner.test",
      new Date(10).toISOString(),
      new Date(20).toISOString(),
      "active",
      "Cafe A",
      "https://a-cafe.web.app",
      "a-1a2b",
      "live",
      "on",
      "free",
      "1.2.0-beta.1",
      "beta",
      "",
      "",
      "unknown",
    ]);
    expect(csv.at(-1)).toContain("zed@owner.test");
  });

  it("quotes what needs it, and keeps a name from becoming a formula", () => {
    expect(csvCell('Tea, "Toast" & co')).toBe('"Tea, ""Toast"" & co"');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(null)).toBe("");
  });
});
