import { DEFAULT_SETTINGS, newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import {
  checkNewCafe,
  checkSettings,
  isMinorLine,
  isProjectId,
  isSiteName,
  isVersion,
  minorLineOf,
  releaseChoiceOf,
  releaseChoiceProblems,
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
        settings: { ...settings, name: " TOE   Cafe " },
      }),
    ).toEqual({ ok: true, settings });
  });

  it("starts on the free plan", () => {
    expect(
      checkNewCafe({
        site: "toe-cafe",
        settings: { ...settings, plan: "pro" as "free" },
      }),
    ).toMatchObject({ ok: false, problems: ["settings-invalid"] });
  });

  it("lists every problem at once", () => {
    expect(
      checkNewCafe({
        site: "TOE Cafe",
        projectId: "Bad Project",
        settings: { ...settings, currency: "rupees" },
        release: { pinned: "latest" },
      }),
    ).toEqual({
      ok: false,
      problems: [
        "site-format",
        "project-id-format",
        "settings-invalid",
        "pinned-format",
      ],
      settingsProblems: ['currency: must be an ISO 4217 code like "INR"'],
    });
  });
});
