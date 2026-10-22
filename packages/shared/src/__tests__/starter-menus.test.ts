import { describe, expect, it } from "vitest";

import { readMenuImport, type ImportSettings } from "../menu-import.ts";
import { LEGACY_MONEY, newCafeSettings } from "../settings.ts";
import {
  STARTER_MENUS,
  STARTER_MENU_IDS,
  STARTER_PRICE_LEVELS,
  hasStarterPrices,
  starterMenuCsv,
  starterPrice,
} from "../starter-menus.ts";

const cafe = (currency: string, locale = "en"): ImportSettings =>
  newCafeSettings({ currency, locale });
const INR = cafe("INR", "en-IN");

describe("starter menus", () => {
  it("are the four the platform offers, each 10 to 20 items", () => {
    expect(STARTER_MENUS.map((m) => m.id)).toEqual([...STARTER_MENU_IDS]);
    for (const menu of STARTER_MENUS) {
      expect(menu.items.length).toBeGreaterThanOrEqual(10);
      expect(menu.items.length).toBeLessThanOrEqual(20);
      expect(new Set(menu.items.map((i) => i.category)).size).toBeGreaterThan(
        1,
      );
    }
  });

  it.each(Object.keys(STARTER_PRICE_LEVELS))(
    "import cleanly in %s, every item priced",
    (currency) => {
      const settings = cafe(currency);
      for (const menu of STARTER_MENUS) {
        const result = readMenuImport(
          starterMenuCsv(menu.id, settings),
          settings,
        );
        expect(result.rows.filter((r) => r.problems.length)).toEqual([]);
        expect(result.items.map((i) => i.name)).toEqual(
          menu.items.map((i) => i.name),
        );
        expect(result.items.every((i) => i.description)).toBe(true);
      }
    },
  );

  it("leave prices empty in a currency with no price level", () => {
    const thb = cafe("THB", "th-TH");
    expect(hasStarterPrices(thb)).toBe(false);
    const result = readMenuImport(starterMenuCsv("bakery", thb), thb);
    expect(result.items).toEqual([]);
    expect(result.rows[0].problems).toEqual(["Needs a price."]);
  });
});

describe("starterPrice", () => {
  it("rounds to a price that reads like a menu", () => {
    // A $4.50 cappuccino.
    expect(starterPrice(450, cafe("USD"))).toBe(450);
    expect(starterPrice(450, INR)).toBe(18_000); // ₹180
    expect(starterPrice(450, cafe("EUR", "de-DE"))).toBe(360); // €3.60
    expect(starterPrice(450, cafe("GBP", "en-GB"))).toBe(340); // £3.40
    expect(starterPrice(450, cafe("JPY", "ja-JP"))).toBe(540); // ¥540
    expect(starterPrice(325, cafe("CAD", "en-CA"))).toBe(375); // C$3.75
  });

  it("gives whole units to a cafe that stores them", () => {
    expect(starterPrice(450, { ...INR, ...LEGACY_MONEY })).toBe(180);
  });

  it("is null where there is no price level", () => {
    expect(starterPrice(450, cafe("BRL", "pt-BR"))).toBeNull();
  });
});
