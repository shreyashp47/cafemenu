import {
  newCafeSettings,
  starterMenu,
  type ImportSettings,
} from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import { startingMenuProblems } from "../../platform/validate";
import { listStart, needsList, startingMenu } from "../menu";

const money = (currency: string, locale = "en"): ImportSettings => {
  const s = newCafeSettings({ currency, locale });
  return {
    currency: s.currency,
    locale: s.locale,
    moneyUnit: s.moneyUnit,
    maxOrderTotal: s.maxOrderTotal,
  };
};

describe("a starter menu", () => {
  it("comes priced, in minor units, where its currency has a price level", () => {
    const inr = money("INR", "en-IN");
    const choice = { kind: "template", id: "coffee-shop" } as const;
    expect(needsList(choice, inr)).toBe(false);
    const result = startingMenu(choice, "", inr);
    expect(result.problem).toBeNull();
    expect(result.count).toBe(starterMenu("coffee-shop").items.length);
    expect(result.menu).toMatchObject({
      source: "template",
      template: "coffee-shop",
      currency: "INR",
    });
    // Rupees in paise, rounded to ₹10.
    for (const item of result.menu!.items) {
      expect(item.price % 1000).toBe(0);
      expect(item.price).toBeGreaterThan(0);
    }
    expect(startingMenuProblems(result.menu!, inr)).toEqual([]);
  });

  it("asks for prices in a currency it has none for", () => {
    const kes = money("KES", "en-KE");
    const choice = { kind: "template", id: "bakery" } as const;
    expect(needsList(choice, kes)).toBe(true);
    const text = listStart(choice, kes);
    expect(text.split("\n")[0]).toMatch(/^name,category,price/);
    // As it comes, every price is empty: nothing to store yet.
    const unpriced = startingMenu(choice, text, kes);
    expect(unpriced.problem).toBe("rows");
    expect(unpriced.menu).toBeNull();
    // Priced by the owner, it is the template still.
    const priced = text.replace(/^([^,\n]+,[^,\n]+),,/gm, "$1,250,");
    const result = startingMenu(choice, priced, kes);
    expect(result.problem).toBeNull();
    expect(result.menu).toMatchObject({
      source: "template",
      template: "bakery",
    });
    expect(result.menu!.items[0].price).toBe(25000);
  });
});

describe("a pasted menu", () => {
  const usd = money("USD", "en-US");
  const choice = { kind: "import" } as const;

  it("reads a list with the shared import, prices in the cafe's unit", () => {
    const result = startingMenu(
      choice,
      "name,category,price\nFlat White,Coffee,4.50\nCroissant,Bakery,3",
      usd,
    );
    expect(result.problem).toBeNull();
    expect(result.menu?.items).toEqual([
      {
        name: "Flat White",
        category: "Coffee",
        description: "",
        price: 450,
        available: true,
      },
      {
        name: "Croissant",
        category: "Bakery",
        description: "",
        price: 300,
        available: true,
      },
    ]);
    expect(result.menu).toMatchObject({ source: "import", template: null });
  });

  it("is not stored with a row to fix, and says which", () => {
    const result = startingMenu(
      choice,
      "Flat White,Coffee,4.50\nMystery,,",
      usd,
    );
    expect(result.problem).toBe("rows");
    expect(result.menu).toBeNull();
    expect(result.rows[1].problems.length).toBeGreaterThan(0);
    expect(result.count).toBe(1);
  });

  it("needs something in it", () => {
    expect(startingMenu(choice, "  \n ", usd).problem).toBe("empty");
  });
});

it("a blank menu has nothing to check", () => {
  expect(startingMenu({ kind: "blank" }, "junk", money("EUR"))).toEqual({
    menu: { source: "blank", template: null, currency: "EUR", items: [] },
    rows: [],
    count: 0,
    problem: null,
  });
});
