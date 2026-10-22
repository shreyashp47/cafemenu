import { describe, expect, it } from "vitest";

import {
  MAX_IMPORT_ROWS,
  menuToCsv,
  readMenuImport,
  type ImportSettings,
} from "../menu-import.ts";
import { LEGACY_MONEY, newCafeSettings } from "../settings.ts";

const INR: ImportSettings = newCafeSettings({ currency: "INR" });
const USD: ImportSettings = newCafeSettings({
  currency: "USD",
  locale: "en-US",
  timeZone: "America/New_York",
});
const JPY: ImportSettings = newCafeSettings({
  currency: "JPY",
  locale: "ja-JP",
  timeZone: "Asia/Tokyo",
});
/** TOE until #21: whole rupees, a ₹10,000 cap. */
const TOE: ImportSettings = { ...INR, ...LEGACY_MONEY };

const HEADER = "name,category,price,description,available\n";

/** The price, or the problems, of a one-row sheet. */
function price(text: string, settings: ImportSettings) {
  const [row] = readMenuImport(
    `${HEADER}Latte,Coffee,${text}\n`,
    settings,
  ).rows;
  return row.item?.price ?? row.problems;
}

describe("readMenuImport", () => {
  it("reads every column, in the header's order", () => {
    const result = readMenuImport(
      'Price (₹),Name,Available,Category,Description\n180,Cappuccino,yes,Coffee,"Foamy, strong"\n',
      INR,
    );
    expect(result.header?.cells[1]).toBe("Name");
    expect(result.items).toEqual([
      {
        name: "Cappuccino",
        category: "Coffee",
        price: 18000,
        description: "Foamy, strong",
        available: true,
      },
    ]);
  });

  it("reads rows with no header in the documented order", () => {
    const result = readMenuImport("Chai,Tea,40,,no\nBun,Food,60\n", INR);
    expect(result.header).toBeNull();
    expect(result.items.map((i) => [i.name, i.price, i.available])).toEqual([
      ["Chai", 4000, false],
      ["Bun", 6000, true],
    ]);
  });

  it("reads a tab-separated paste from a spreadsheet", () => {
    const result = readMenuImport(
      "Name\tCategory\tPrice\nFlat white\tCoffee\t4,75\n",
      USD,
    );
    expect(result.items[0]).toMatchObject({ name: "Flat white", price: 475 });
  });

  it("skips blank rows but keeps the spreadsheet's row numbers", () => {
    const result = readMenuImport(`${HEADER}\n,,,,\nTea,Hot,3\n`, USD);
    expect(result.rows.map((r) => r.row)).toEqual([4]);
  });

  it("names every problem a row has", () => {
    const result = readMenuImport(
      `${HEADER},,abc,${"x".repeat(201)},maybe\n`,
      INR,
    );
    expect(result.items).toEqual([]);
    expect(result.rows[0].problems).toEqual([
      "Needs a name.",
      "Needs a category.",
      `"abc" isn't a price in ₹: use a number with up to 2 decimals, like 4.50.`,
      "Description is 201 characters; the most is 200.",
      'Available is "maybe": use yes or no, or leave it empty for yes.',
    ]);
  });

  it("refuses names and categories that are too long", () => {
    const [row] = readMenuImport(
      `${HEADER}${"N".repeat(61)},${"C".repeat(41)},10\n`,
      INR,
    ).rows;
    expect(row.problems).toEqual([
      "Name is 61 characters; the most is 60.",
      "Category is 41 characters; the most is 40.",
    ]);
  });

  it("refuses a name twice in the sheet, and one already on the menu", () => {
    const result = readMenuImport(
      `${HEADER}Mocha,Coffee,5\nmocha ,Coffee,6\nEspresso,Coffee,3\n`,
      USD,
      { existingNames: ["ESPRESSO"] },
    );
    expect(result.rows.map((r) => r.problems)).toEqual([
      [],
      ["Same name as row 2."],
      ["Already on the menu."],
    ]);
    expect(result.items.map((i) => i.name)).toEqual(["Mocha"]);
  });

  it("files a category under the menu's own spelling", () => {
    const result = readMenuImport(
      `${HEADER}Mocha,coffee,5\nTea,TEA ,3\nScone,food,4\nBun,Food,4\n`,
      USD,
      { existingCategories: ["Coffee"] },
    );
    expect(result.items.map((i) => i.category)).toEqual([
      "Coffee",
      "TEA",
      "food",
      "food",
    ]);
  });

  it("stops at the row limit", () => {
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `Item ${i},Food,1\n`,
    );
    const result = readMenuImport(HEADER + rows.join(""), USD);
    expect(result.items).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.rows.at(-1)!.problems[0]).toMatch(/200-row limit/);
  });
});

describe("prices, per currency", () => {
  it("INR: rupees and paise, as the stored paise", () => {
    expect(price("180", INR)).toBe(18000);
    expect(price("180.5", INR)).toBe(18050);
    expect(price("₹180.50", INR)).toBe(18050);
    expect(price("INR 180", INR)).toBe(18000);
    expect(price("180.505", INR)).toEqual([
      `"180.505" isn't a price in ₹: use a number with up to 2 decimals, like 4.50.`,
    ]);
    // Grouping is refused rather than read as ₹1.
    expect(price('"1,200"', INR)).toHaveLength(1);
  });

  it("INR: no more than one order may total", () => {
    expect(price("10000", INR)).toBe(1_000_000);
    expect(price("10001", INR)).toEqual([
      "₹10,001 is more than one order may total (₹10,000), so nobody could order it.",
    ]);
  });

  it("INR in TOE's whole rupees: no paise", () => {
    expect(price("180", TOE)).toBe(180);
    expect(price("180.00", TOE)).toBe(180);
    expect(price("180.50", TOE)).toEqual([
      `"180.50" isn't a price in ₹: use a whole number, like 450.`,
    ]);
  });

  it("USD: dollars and cents, comma or point", () => {
    expect(price("4.5", USD)).toBe(450);
    expect(price('"4,50"', USD)).toBe(450);
    expect(price("$4.50", USD)).toBe(450);
    expect(price("4.500", USD)).toEqual([
      `"4.500" isn't a price in $: use a number with up to 2 decimals, like 4.50.`,
    ]);
    expect(price("0", USD)).toEqual(["Price has to be more than 0."]);
    expect(price("", USD)).toEqual(["Needs a price."]);
    expect(price("151", USD)).toHaveLength(1);
  });

  it("JPY: whole yen only", () => {
    expect(price("1200", JPY)).toBe(1200);
    expect(price("¥1200", JPY)).toBe(1200);
    expect(price("1200.00", JPY)).toBe(1200);
    expect(price("12.5", JPY)).toEqual([
      `"12.5" isn't a price in ￥: use a whole number, like 450.`,
    ]);
    // "1,000" is a thousand yen with grouping, not ¥1: refused.
    expect(price('"1,000"', JPY)).toHaveLength(1);
  });
});

describe("menuToCsv", () => {
  it("writes what readMenuImport reads back, empty prices included", () => {
    const items = [
      {
        name: "Salt, Caramel Latte",
        category: "Coffee",
        description: 'The "good" one',
        price: 18050,
        available: false,
      },
    ];
    const text = menuToCsv(items, INR);
    expect(text).toBe(
      'name,category,price,description,available\n"Salt, Caramel Latte",Coffee,180.50,"The ""good"" one",no\n',
    );
    expect(readMenuImport(text, INR).items).toEqual(items);
    expect(menuToCsv([{ ...items[0], price: null }], INR)).toContain(
      "Coffee,,",
    );
  });
});
