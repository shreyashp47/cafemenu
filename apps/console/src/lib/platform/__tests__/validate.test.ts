import { DEFAULT_SETTINGS, newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import { FIRESTORE_LOCATIONS, isFirestoreLocation } from "../locations";
import type { StartingMenu } from "../model";
import {
  checkNewCafe,
  checkSettings,
  isMinorLine,
  isProjectId,
  isRegionFormat,
  isSiteName,
  isStartingMenuItem,
  isVersion,
  minorLineOf,
  releaseChoiceOf,
  releaseChoiceProblems,
  startingMenuProblems,
} from "../validate";

describe("site names (a hostname label, at most 30 characters)", () => {
  it.each(["toe-cafe", "cafe42", "a", "a".repeat(30), "my-cafe-2"])(
    "takes %s",
    (name) => expect(isSiteName(name)).toBe(true),
  );
  it.each([
    "Toe-Cafe",
    "toe_cafe",
    "toe.cafe",
    "-toe",
    "toe-",
    "",
    "a".repeat(31),
    "café",
  ])("refuses %j", (name) => expect(isSiteName(name)).toBe(false));
});

describe("project IDs", () => {
  it.each(["toi-cafe", "their-cafe-1a2b3", "abcdef", `a${"b".repeat(29)}`])(
    "takes %s",
    (id) => expect(isProjectId(id)).toBe(true),
  );
  it.each(["abcde", "1cafe-x", "cafe-", "Cafe-x", `a${"b".repeat(30)}`, null])(
    "refuses %j",
    (id) => expect(isProjectId(id)).toBe(false),
  );
});

describe("versions and minor lines", () => {
  it("knows a version", () => {
    expect(isVersion("1.4.2")).toBe(true);
    expect(isVersion("1.5.0-beta.1")).toBe(true);
    expect(isVersion("1.4")).toBe(false);
    expect(isVersion("v1.4.2")).toBe(false);
  });
  it("knows a minor line", () => {
    expect(isMinorLine("1.4")).toBe(true);
    expect(isMinorLine("1.4.2")).toBe(false);
    expect(isMinorLine("1.x")).toBe(false);
  });
  it("finds a version's minor line", () => {
    expect(minorLineOf("1.4.2")).toBe("1.4");
    expect(minorLineOf("2.0.0-beta.3")).toBe("2.0");
    expect(minorLineOf("latest")).toBeNull();
  });
});

describe("settings (the shared CafeSettings check)", () => {
  it("takes complete settings and returns them cleaned", () => {
    const result = checkSettings(
      newCafeSettings({ name: "TOE Cafe", tables: [2, 1] }),
    );
    expect(result).toMatchObject({
      ok: true,
      settings: { name: "TOE Cafe", tables: [1, 2] },
    });
  });
  it("names every problem", () => {
    const result = checkSettings({ ...DEFAULT_SETTINGS, name: "", extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        "extra: not a setting",
        "name: must be text of 1 to 60 characters",
      ]);
    }
  });
  it("refuses anything but settings", () => {
    for (const bad of ["TOE", null, [], 3]) {
      expect(checkSettings(bad).ok).toBe(false);
    }
  });
});

describe("the release choice", () => {
  it("defaults to stable, following new versions", () => {
    expect(releaseChoiceOf(undefined)).toEqual({
      channel: "stable",
      pinned: null,
    });
  });
  it("takes beta and a pin", () => {
    expect(releaseChoiceProblems({ channel: "beta", pinned: "1.4" })).toEqual(
      [],
    );
  });
  it("refuses an unknown channel and a pin that is not a minor line", () => {
    expect(
      releaseChoiceProblems({
        channel: "nightly" as "beta",
        pinned: "1.4.2",
      }),
    ).toEqual(["channel-unknown", "pinned-format"]);
  });
});

describe("a new cafe", () => {
  const settings = newCafeSettings({ name: "TOE Cafe" });

  it("needs a site and complete settings, and returns them cleaned", () => {
    expect(
      checkNewCafe({
        site: "toe-cafe",
        region: "asia-south1",
        settings: { ...settings, name: " TOE   Cafe " },
      }),
    ).toEqual({ ok: true, settings });
  });

  it("starts on the free plan", () => {
    expect(
      checkNewCafe({
        site: "toe-cafe",
        region: "asia-south1",
        settings: { ...settings, plan: "pro" as "free" },
      }),
    ).toMatchObject({ ok: false, problems: ["settings-invalid"] });
  });

  it("lists every problem at once", () => {
    expect(
      checkNewCafe({
        site: "TOE Cafe",
        region: "the-moon",
        projectId: "Bad Project",
        settings: { ...settings, currency: "rupees" },
        release: { pinned: "latest" },
      }),
    ).toEqual({
      ok: false,
      problems: [
        "site-format",
        "region-unknown",
        "project-id-format",
        "settings-invalid",
        "pinned-format",
      ],
      settingsProblems: ['currency: must be an ISO 4217 code like "INR"'],
    });
  });
});

describe("database regions", () => {
  it("lists each location once, every one in the shape the rules take", () => {
    const ids = FIRESTORE_LOCATIONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isRegionFormat(id)).toBe(true);
  });

  it("knows the multi-regions and the regions, and nothing else", () => {
    for (const id of [
      "nam5",
      "eur3",
      "asia-south1",
      "northamerica-northeast1",
    ]) {
      expect(isFirestoreLocation(id)).toBe(true);
    }
    for (const id of ["asia-south9", "Asia-South1", "", "mars"]) {
      expect(isFirestoreLocation(id)).toBe(false);
    }
    // A shape the rules would take, but not a location the console offers.
    expect(isRegionFormat("asia-south9")).toBe(true);
    expect(isRegionFormat("asia south1")).toBe(false);
  });
});

describe("a starting menu", () => {
  const item = {
    name: "Flat White",
    category: "Coffee",
    description: "",
    price: 18000,
    available: true,
  };
  const menu = (fields: Partial<StartingMenu> = {}): StartingMenu => ({
    source: "template",
    template: "coffee-shop",
    currency: "INR",
    items: [item],
    ...fields,
  });
  const inr = { currency: "INR" };

  it("passes a starter, a pasted list and a blank menu", () => {
    expect(startingMenuProblems(menu(), inr)).toEqual([]);
    expect(
      startingMenuProblems(menu({ source: "import", template: null }), inr),
    ).toEqual([]);
    expect(
      startingMenuProblems(
        menu({ source: "blank", template: null, items: [] }),
        inr,
      ),
    ).toEqual([]);
  });

  it("names what does not add up", () => {
    expect(startingMenuProblems(menu({ template: "steakhouse" }), inr)).toEqual(
      ["menu-template"],
    );
    expect(startingMenuProblems(menu({ currency: "USD" }), inr)).toEqual([
      "menu-currency",
    ]);
    expect(startingMenuProblems(menu({ items: [] }), inr)).toEqual([
      "menu-empty",
    ]);
    expect(
      startingMenuProblems(
        menu({ items: Array.from({ length: 201 }, () => item) }),
        inr,
      ),
    ).toEqual(["menu-too-long"]);
    expect(
      startingMenuProblems(menu({ items: [{ ...item, price: 0 }] }), inr),
    ).toEqual(["menu-item"]);
  });

  it("checks each row as the cafe app's import would", () => {
    expect(isStartingMenuItem(item)).toBe(true);
    for (const bad of [
      { ...item, name: "" },
      { ...item, name: "x".repeat(61) },
      { ...item, category: "x".repeat(41) },
      { ...item, description: "x".repeat(201) },
      { ...item, price: 4.5 },
      { ...item, available: "yes" },
      { ...item, image: "https://x.test/a.png" },
    ]) {
      expect(isStartingMenuItem(bad)).toBe(false);
    }
  });
});
