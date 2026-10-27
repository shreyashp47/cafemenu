/**
 * One cafe's history (#78): requests, deployments, status changes,
 * maintenance windows and emails, as one timeline; and the admin log's
 * filter and CSV.
 */

import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import type {
  AdminLogEntry,
  BackendRequest,
  Cafe,
  Deployment,
} from "../../platform/model";
import { historyItems, maintenanceWindows } from "../history";
import { LOG_CSV_HEADER, filterLog, logCsv } from "../log";

const entry = (
  id: string,
  action: string,
  at: number,
  over: Partial<AdminLogEntry> = {},
): AdminLogEntry => ({
  id,
  at,
  by: "admin-uid",
  byEmail: "erin@platform.test",
  action,
  cafeId: "c1",
  ownerUid: "u1",
  reason: null,
  details: {},
  ...over,
});

const request = (id: string, status: BackendRequest["status"], at: number) =>
  ({
    id,
    cafeId: "c1",
    kind: "suspend",
    params: {},
    status,
    by: "admin-uid",
    createdAt: at,
    progress: null,
    result: null,
    error: null,
    errorCode: null,
    deploymentId: null,
    notBefore: null,
    finishedAt: null,
  }) satisfies BackendRequest;

const deployment = { id: "d1", createdAt: 15 } as Deployment;

const history = {
  requests: [request("r-done", "done", 30), request("r-waiting", "queued", 40)],
  deployments: [deployment],
  log: [
    entry("r-done", "suspend", 31, { reason: { code: "abuse", note: "" } }),
    entry("m1", "maintenance-on", 10),
    entry("m2", "maintenance-off", 20),
    entry("m3", "maintenance-on", 50),
  ],
  emails: [{ id: "e1", kind: "account-suspended", at: 32 }],
};

describe("a cafe's timeline", () => {
  it("is everything, newest first, a done admin request shown by its log entry", () => {
    expect(
      historyItems(history).map((i) =>
        i.kind === "request"
          ? i.request.id
          : i.kind === "deployment"
            ? i.deployment.id
            : i.kind === "admin"
              ? i.entry.id
              : i.email.id,
      ),
    ).toEqual(["m3", "r-waiting", "e1", "r-done", "m2", "d1", "m1"]);
  });

  it("filters to one kind of thing", () => {
    const ids = (filter: Parameters<typeof historyItems>[1]) =>
      historyItems(history, filter).map((i) => `${i.kind}:${i.at}`);
    expect(ids("requests")).toEqual(["request:40"]);
    expect(ids("deployments")).toEqual(["deployment:15"]);
    expect(ids("status")).toEqual(["admin:31"]);
    expect(ids("maintenance")).toEqual(["admin:50", "admin:20", "admin:10"]);
    expect(ids("emails")).toEqual(["email:32"]);
  });

  it("pairs maintenance on and off into windows, the open one first", () => {
    expect(maintenanceWindows(history.log).map((w) => [w.from, w.to])).toEqual([
      [50, null],
      [10, 20],
    ]);
  });
});

describe("the admin log", () => {
  const cafe = {
    id: "c1",
    settings: newCafeSettings({ name: "Tea Room" }),
  } as Cafe;
  const lookups = {
    cafes: new Map([["c1", cafe]]),
    owners: new Map([
      [
        "u1",
        {
          uid: "u1",
          email: "owen@owner.test",
          name: null,
          createdAt: null,
          lastSignInAt: null,
          admin: false,
          disabled: false,
          status: "active" as const,
          statusReason: null,
          statusChangedAt: null,
        },
      ],
    ]),
  };
  const log = [
    entry("1", "suspend", 3, { reason: { code: "abuse", note: "Spam." } }),
    entry("2", "delete-owner", 2, {
      cafeId: "gone",
      ownerUid: "u9",
      details: { site: "old-cafe" },
    }),
    entry("3", "appoint-admin", 1, {
      cafeId: null,
      ownerUid: null,
      details: { email: "ada@platform.test" },
    }),
  ];

  it("filters by action and by what an entry is about", () => {
    const ids = (action: string, query = "") =>
      filterLog(log, { action: action as "all", query }, lookups).map(
        (e) => e.id,
      );
    expect(ids("all")).toEqual(["1", "2", "3"]);
    expect(ids("suspend")).toEqual(["1"]);
    expect(ids("all", "tea room")).toEqual(["1"]);
    expect(ids("all", "OWEN@")).toEqual(["1"]);
    expect(ids("all", "spam")).toEqual(["1"]);
    // A deleted cafe is still found by the address the entry kept.
    expect(ids("all", "old-cafe")).toEqual(["2"]);
    expect(ids("all", "ada@")).toEqual(["3"]);
  });

  it("exports as CSV", () => {
    const lines = logCsv(log, lookups).split("\r\n");
    expect(lines[0]).toBe(LOG_CSV_HEADER.join(","));
    expect(lines[1].split(",").slice(0, 8)).toEqual([
      new Date(3).toISOString(),
      "erin@platform.test",
      "suspend",
      "Tea Room",
      "c1",
      "owen@owner.test",
      "abuse",
      "Spam.",
    ]);
    expect(lines[2]).toContain("old-cafe.web.app");
  });
});
