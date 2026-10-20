import { describe, expect, it } from "vitest";

import { PLAN_FEATURES, features, type Features } from "../features.ts";
import {
  DEFAULT_SETTINGS,
  PLANS,
  parseCafeSettings,
  type PlanId,
} from "../settings.ts";

// Every feature `Features` declares, so a new one cannot be left out of a plan
// without this list (and so this test) changing too.
const ALL: (keyof Features)[] = ["csvExport"];

describe("features", () => {
  it("gives the free plan every feature, so no cafe sees a change", () => {
    const free = features({ plan: "free" });
    for (const name of ALL) expect(free[name]).toBe(true);
  });

  it("is what the default settings get", () => {
    expect(DEFAULT_SETTINGS.plan).toBe("free");
    expect(features(DEFAULT_SETTINGS)).toEqual(PLAN_FEATURES.free);
  });

  it("gives a plan this release does not know the free plan's features", () => {
    expect(features({ plan: "gold" as PlanId })).toEqual(PLAN_FEATURES.free);
    // which is also how settings with such a plan are read in the first place
    expect(features(parseCafeSettings({ plan: "gold" }))).toEqual(
      PLAN_FEATURES.free,
    );
  });

  it("hands back a copy the caller may change", () => {
    const mine = features({ plan: "free" });
    mine.csvExport = false;
    expect(features({ plan: "free" }).csvExport).toBe(true);
    expect(Object.isFrozen(PLAN_FEATURES.free)).toBe(true);
  });

  it("has a row for every plan, saying yes or no to every feature", () => {
    expect(Object.keys(PLAN_FEATURES).sort()).toEqual([...PLANS].sort());
    for (const plan of PLANS) {
      expect(Object.keys(PLAN_FEATURES[plan]).sort()).toEqual([...ALL].sort());
      for (const name of ALL) {
        expect(typeof PLAN_FEATURES[plan][name]).toBe("boolean");
      }
    }
  });
});
