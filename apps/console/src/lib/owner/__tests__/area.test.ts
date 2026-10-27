import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import type { Cafe } from "../../platform/model";
import { cafeToShow, dashboardUrl, siteHost } from "../area";

const cafe = (id: string, status: Cafe["status"], site = id): Cafe => ({
  id,
  ownerUid: "u1",
  ownerEmail: "o@x.test",
  projectId: null,
  site,
  region: "nam5",
  settings: newCafeSettings({ name: id }),
  release: { channel: "stable", pinned: null, current: null, previous: null },
  status,
  createdAt: 1,
  updatedAt: 1,
});

describe("which cafe is shown", () => {
  it("is the one asked for, if it is the owner's", () => {
    const list = [cafe("a", "live"), cafe("b", "draft")];
    expect(cafeToShow(list, "b")?.id).toBe("b");
    expect(cafeToShow(list, "nobody-s")?.id).toBe("a");
  });

  it("prefers the oldest cafe that is past setup", () => {
    expect(
      cafeToShow(
        [cafe("a", "draft"), cafe("b", "live"), cafe("c", "live")],
        null,
      )?.id,
    ).toBe("b");
  });

  it("falls back to the newest draft, and to nothing", () => {
    expect(cafeToShow([cafe("a", "draft"), cafe("b", "draft")], null)?.id).toBe(
      "b",
    );
    expect(cafeToShow([], null)).toBeNull();
    expect(cafeToShow([], "a")).toBeNull();
  });
});

describe("the cafe's own site", () => {
  it("puts the dashboard at /admin of the web address", () => {
    expect(siteHost("lantern-cafe")).toBe("lantern-cafe.web.app");
    expect(dashboardUrl("lantern-cafe")).toBe(
      "https://lantern-cafe.web.app/admin",
    );
  });

  it("builds nothing from a name that is not a web address", () => {
    expect(dashboardUrl("Not A Site")).toBeNull();
    expect(dashboardUrl("evil.example/x?")).toBeNull();
    expect(siteHost("")).toBeNull();
  });
});
