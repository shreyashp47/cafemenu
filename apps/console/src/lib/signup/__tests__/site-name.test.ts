import { describe, expect, it } from "vitest";
import { isSiteName } from "../../platform/validate";
import { siteNameFrom, siteNameProblem, siteSuggestions } from "../site-name";

describe("a web address name", () => {
  it("is a Hosting site ID, or says what is wrong", () => {
    expect(siteNameProblem("lantern-cafe")).toBeNull();
    expect(siteNameProblem("a1")).toBeNull();
    expect(siteNameProblem("")).toBe("empty");
    expect(siteNameProblem("Lantern")).toBe("characters");
    expect(siteNameProblem("lantern_cafe")).toBe("characters");
    expect(siteNameProblem("lantern café")).toBe("characters");
    expect(siteNameProblem("-lantern")).toBe("hyphen-ends");
    expect(siteNameProblem("lantern-")).toBe("hyphen-ends");
    expect(siteNameProblem("a".repeat(30))).toBeNull();
    expect(siteNameProblem("a".repeat(31))).toBe("too-long");
  });

  it("agrees with the rules' pattern", () => {
    for (const name of [
      "ok-name",
      "x",
      "9lives",
      "-x",
      "x-",
      "X",
      "a".repeat(31),
    ]) {
      expect(siteNameProblem(name) === null).toBe(isSiteName(name));
    }
  });
});

describe("a name made from the cafe's", () => {
  it.each([
    ["Lantern Café", "lantern-cafe"],
    ["Alice's Coffee & Cake", "alices-coffee-and-cake"],
    ["  The   Corner  ", "the-corner"],
    ["Brühl Kaffeehaus", "bruhl-kaffeehaus"],
    ["Café №5", "cafe-no5"],
    ["カフェ", ""],
    [
      "The Very Long Name Of A Small Cafe Downtown",
      "the-very-long-name-of-a-small",
    ],
  ])("%s → %s", (name, site) => {
    expect(siteNameFrom(name)).toBe(site);
    if (site) expect(isSiteName(site)).toBe(true);
  });
});

describe("names to offer instead", () => {
  it("adds an ending, never repeats the name, and fits", () => {
    const offers = siteSuggestions("lantern", { country: "IN" });
    expect(offers).toEqual(["lantern-cafe", "lantern-menu", "lantern-in"]);
    for (const name of siteSuggestions("a".repeat(30))) {
      expect(isSiteName(name)).toBe(true);
    }
  });

  it("does not offer -cafe after -cafe, or a name to avoid", () => {
    const offers = siteSuggestions("lantern-cafe", {
      avoid: ["lantern-cafe-menu"],
      count: 2,
    });
    expect(offers).toEqual([
      "lantern-cafe-orders",
      expect.stringMatching(/^lantern-cafe-\d{2}$/),
    ]);
  });

  it("is stable for a name, and empty when there is nothing to build on", () => {
    expect(siteSuggestions("lantern", { count: 5 })).toEqual(
      siteSuggestions("lantern", { count: 5 }),
    );
    expect(siteSuggestions("カフェ")).toEqual([]);
  });
});
