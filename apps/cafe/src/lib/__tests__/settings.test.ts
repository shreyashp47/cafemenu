/**
 * The page's settings (src/lib/settings.ts): site.json, then config/site, over
 * the defaults, kept on the device. Each test sets the boot it needs; the
 * suite's own default is demo mode with no site.json (src/test/setup.ts).
 */

import { DEFAULT_SETTINGS, type CafeSettings } from "@cafemenu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { primeBoot, retryBoot, type Boot, type Fetched } from "@/lib/boot";
import {
  SETTINGS_KEY,
  UNKNOWN_SETTINGS,
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  resetSettings,
  setLiveSettings,
  subscribeSettings,
} from "@/lib/settings";
import type { SiteFile } from "@cafemenu/shared";
import { primeSuiteBoot } from "@/test/cafe";

const CONFIG = {
  apiKey: "k",
  appId: "a",
  projectId: "their-cafe",
  authDomain: "their-cafe.firebaseapp.com",
};
const firebase: Boot["backend"] = {
  kind: "firebase",
  config: CONFIG,
  source: "hosting",
};

function siteJson(settings: Record<string, unknown>): Fetched<SiteFile> {
  return { status: "ok", value: { settings, demo: false } };
}

function bootWith(backend: Boot["backend"], site: Fetched<SiteFile>) {
  primeBoot({ backend, site });
  resetSettings();
}

function keptOnDevice(settings: Partial<CafeSettings>) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }),
  );
  resetSettings();
}

afterEach(() => {
  vi.unstubAllGlobals();
  primeSuiteBoot();
});

describe("before anything has answered", () => {
  it("is unknown, with no name rather than the demo cafe's", () => {
    expect(UNKNOWN_SETTINGS.ready).toBe(false);
    expect(UNKNOWN_SETTINGS.settings.name).toBe("");
    expect(UNKNOWN_SETTINGS.settings.tagline).toBe("");
    // The static export is rendered that way too.
    expect(getServerSettingsSnapshot()).toBe(UNKNOWN_SETTINGS);
  });

  it("paints the device's copy while the boot is still out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    void retryBoot();
    keptOnDevice({ name: "TOE Cafe" });
    expect(getSettingsSnapshot()).toEqual({
      settings: { ...DEFAULT_SETTINGS, name: "TOE Cafe" },
      ready: true,
    });
  });

  it("stays unknown while booting with no copy on the device", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    void retryBoot();
    resetSettings();
    expect(getSettingsSnapshot()).toBe(UNKNOWN_SETTINGS);
  });

  it("tells listeners when the boot settles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    const pending = retryBoot();
    resetSettings();
    const listener = vi.fn();
    const off = subscribeSettings(listener);
    await pending;
    await Promise.resolve();
    expect(listener).toHaveBeenCalled();
    expect(getSettingsSnapshot().settings.name).toBe(DEFAULT_SETTINGS.name);
    off();
  });
});

describe("demo mode", () => {
  it("is the demo cafe, ready straight away", () => {
    bootWith({ kind: "demo" }, { status: "missing" });
    expect(getSettingsSnapshot()).toEqual({
      settings: DEFAULT_SETTINGS,
      ready: true,
    });
  });

  it("is site.json's cafe on a preview deploy", () => {
    bootWith(
      { kind: "demo" },
      { status: "ok", value: { settings: { name: "TOE Cafe" }, demo: true } },
    );
    expect(getSettingsSnapshot().settings.name).toBe("TOE Cafe");
  });
});

describe("a real cafe", () => {
  it("paints site.json's settings before Firestore answers", () => {
    bootWith(firebase, siteJson({ name: "TOE Cafe", tagline: "Since 2019" }));
    expect(getSettingsSnapshot()).toEqual({
      settings: {
        ...DEFAULT_SETTINGS,
        name: "TOE Cafe",
        tagline: "Since 2019",
      },
      ready: true,
    });
  });

  it("lets config/site win over site.json, field by field", () => {
    bootWith(firebase, siteJson({ name: "TOE Cafe", tagline: "Since 2019" }));
    setLiveSettings({ tagline: "Now open late" });
    expect(getSettingsSnapshot().settings).toMatchObject({
      name: "TOE Cafe",
      tagline: "Now open late",
    });
  });

  it("keeps site.json's settings when config/site does not exist", () => {
    bootWith(firebase, siteJson({ name: "TOE Cafe" }));
    setLiveSettings(null);
    expect(getSettingsSnapshot().settings.name).toBe("TOE Cafe");
  });

  it("without a site.json, waits for config/site rather than show the demo cafe", () => {
    bootWith(firebase, { status: "missing" });
    expect(getSettingsSnapshot()).toBe(UNKNOWN_SETTINGS);
    setLiveSettings({ name: "TOE Cafe" });
    expect(getSettingsSnapshot()).toEqual({
      settings: { ...DEFAULT_SETTINGS, name: "TOE Cafe" },
      ready: true,
    });
  });

  it("without a site.json, shows the device's copy while it waits", () => {
    bootWith(firebase, { status: "missing" });
    keptOnDevice({ name: "TOE Cafe" });
    expect(getSettingsSnapshot().settings.name).toBe("TOE Cafe");
  });

  it("offline, uses the device's copy where site.json would be", () => {
    bootWith(firebase, { status: "error" });
    keptOnDevice({ name: "TOE Cafe", tables: [1, 2, 3, 4, 5, 6, 7, 8] });
    setLiveSettings({ tagline: "Live tagline" });
    expect(getSettingsSnapshot().settings).toMatchObject({
      name: "TOE Cafe",
      tagline: "Live tagline",
      tables: [1, 2, 3, 4, 5, 6, 7, 8],
    });
  });

  it("an unreachable cafe still shows its name from site.json", () => {
    bootWith(
      { kind: "unreachable", reason: "offline" },
      siteJson({ name: "TOE Cafe" }),
    );
    expect(getSettingsSnapshot().settings.name).toBe("TOE Cafe");
  });
});

// What the stored integers count (#12). TOE's data is whole rupees until #21
// migrates it; nothing may read them as paise meanwhile.
describe("money: the unit the page reads prices in", () => {
  const toeBefore12 = { schemaVersion: 1, name: "TOE Cafe", currency: "INR" };
  const inPaise = {
    schemaVersion: 2,
    name: "New Cafe",
    moneyUnit: "minor",
    maxOrderTotal: 1_000_000,
  };
  const money = () => {
    const { moneyUnit, maxOrderTotal } = getSettingsSnapshot().settings;
    return { moneyUnit, maxOrderTotal };
  };

  it("reads TOE's settings from before #12 as whole rupees", () => {
    bootWith(firebase, siteJson(toeBefore12));
    expect(money()).toEqual({ moneyUnit: "major", maxOrderTotal: 10_000 });
    setLiveSettings(toeBefore12);
    expect(money()).toEqual({ moneyUnit: "major", maxOrderTotal: 10_000 });
  });

  it("reads a cafe in minor units as minor units, with its cap", () => {
    bootWith(firebase, siteJson(inPaise));
    setLiveSettings({ ...inPaise, maxOrderTotal: 900_000 });
    expect(money()).toEqual({ moneyUnit: "minor", maxOrderTotal: 900_000 });
  });

  it("goes by config/site when it is older than site.json, as the rules do", () => {
    bootWith(firebase, siteJson(inPaise));
    setLiveSettings(toeBefore12);
    expect(money()).toEqual({ moneyUnit: "major", maxOrderTotal: 10_000 });
  });

  it("with no config/site, keeps site.json's unit but the rules' cap", () => {
    bootWith(firebase, siteJson(inPaise));
    setLiveSettings(null);
    expect(money()).toEqual({ moneyUnit: "minor", maxOrderTotal: 10_000 });
  });

  it("with neither file, is a project from before CafeMenu: whole rupees", () => {
    bootWith(firebase, { status: "missing" });
    setLiveSettings(null);
    expect(money()).toEqual({ moneyUnit: "major", maxOrderTotal: 10_000 });
  });

  it("in demo mode is always minor units, the demo store's", () => {
    bootWith(
      { kind: "demo" },
      { status: "ok", value: { settings: toeBefore12, demo: true } },
    );
    expect(money()).toEqual({ moneyUnit: "minor", maxOrderTotal: 1_000_000 });
    setLiveSettings({ currency: "JPY", moneyUnit: "major" });
    expect(money()).toEqual({ moneyUnit: "minor", maxOrderTotal: 20_000 });
  });
});

describe("the device's copy", () => {
  it("is the merged result, written when it changes", () => {
    bootWith(firebase, siteJson({ name: "TOE Cafe" }));
    setLiveSettings({ tagline: "Live" });
    getSettingsSnapshot();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({
      name: "TOE Cafe",
      tagline: "Live",
    });
  });

  it("is not rewritten from itself", () => {
    bootWith(firebase, { status: "missing" });
    keptOnDevice({ name: "TOE Cafe" });
    const write = vi.spyOn(Storage.prototype, "setItem");
    getSettingsSnapshot();
    expect(write).not.toHaveBeenCalled();
  });

  it("is ignored when damaged", () => {
    bootWith(firebase, { status: "missing" });
    localStorage.setItem(SETTINGS_KEY, "{broken");
    resetSettings();
    expect(getSettingsSnapshot()).toBe(UNKNOWN_SETTINGS);
  });
});

describe("getSettingsSnapshot", () => {
  it("hands back the same object until something changes", () => {
    bootWith(firebase, siteJson({ name: "TOE Cafe" }));
    const first = getSettingsSnapshot();
    expect(getSettingsSnapshot()).toBe(first);
    setLiveSettings({ name: "TOE Cafe" });
    expect(getSettingsSnapshot()).toBe(first);
    setLiveSettings({ name: "TOE Cafe & Bakery" });
    expect(getSettingsSnapshot()).not.toBe(first);
  });
});
