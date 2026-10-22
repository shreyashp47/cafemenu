/**
 * Menu import (issue #16): rows of a spreadsheet, checked one by one before
 * any of them reaches the menu.
 *
 * The owner pastes or uploads CSV with the columns
 *
 *   name, category, price, description, available
 *
 * in that order, or in any order under a header row naming them. Only name,
 * category and price need a value. Each row comes back either as a menu item
 * or with every reason it is not one, in words the owner can act on, so the
 * good rows can go in and the bad ones be fixed on screen.
 *
 * Prices are read in the cafe's currency and unit, as the price field reads
 * them (parseMoneyInput): "4.50" in dollars, "180" or "180.50" in rupees,
 * "1200" in yen. The cafe's own symbol or code may come with it ("₹180",
 * "USD 4.50"), since spreadsheets often format prices that way.
 *
 * Like the rest of this package: no dependencies, erasable syntax only.
 */

import { parseCsv, toCsv, type CsvRow } from "./csv.ts";
import {
  currencySymbol,
  formatMoney,
  moneyDigits,
  moneyToDecimal,
  parseMoneyInput,
} from "./money.ts";
import type { CafeSettings } from "./settings.ts";

/** What checking a price needs: the currency, its unit, and the order cap. */
export type ImportSettings = Pick<
  CafeSettings,
  "currency" | "locale" | "moneyUnit" | "maxOrderTotal"
>;

/** The longest each text may be, so a menu row stays a row on a phone. */
export const MENU_TEXT_LIMITS = {
  name: 60,
  category: 40,
  description: 200,
} as const;

/** One import at a time, well inside Firestore's 500 writes in a batch. */
export const MAX_IMPORT_ROWS = 200;

export const MENU_COLUMNS = [
  "name",
  "category",
  "price",
  "description",
  "available",
] as const;
export type MenuColumn = (typeof MENU_COLUMNS)[number];

/** A menu item as the import writes it, before it has an id. */
export interface MenuImportItem {
  name: string;
  category: string;
  description: string;
  /** In the cafe's unit (settings.moneyUnit), above 0. */
  price: number;
  available: boolean;
}

export interface MenuImportRow {
  /** 1-based, as the spreadsheet numbers it, the header being row 1. */
  row: number;
  /** Where the row is in the text, to select it for fixing. */
  start: number;
  end: number;
  /** The item, when the row has no problems. */
  item: MenuImportItem | null;
  /** The name as written, to say which row a problem is on. */
  name: string;
  problems: string[];
}

export interface MenuImport {
  /** The header row, when there is one. */
  header: CsvRow | null;
  /** Every row with something in it; blank rows are left out. */
  rows: MenuImportRow[];
  /** The rows' items, in order: what an import writes. */
  items: MenuImportItem[];
}

export interface ImportOptions {
  /**
   * Names already on the menu: a row repeating one is a problem, so adding
   * the same sheet twice can't double the menu. Leave it out when the import
   * replaces the menu.
   */
  existingNames?: readonly string[];
  /**
   * The menu's categories: a row's "coffee" files under the menu's "Coffee"
   * rather than starting a second one.
   */
  existingCategories?: readonly string[];
}

// Header names each column answers to, after `headerKey`.
const HEADER_NAMES: Record<MenuColumn, string[]> = {
  name: ["name", "item", "itemname"],
  category: ["category", "section", "group"],
  price: ["price", "cost"],
  description: ["description", "desc", "details"],
  available: ["available", "availability", "instock"],
};

/** "Price (₹)" and "In stock" as "price" and "instock". */
function headerKey(cell: string): string {
  return cell
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z]/g, "");
}

function headerColumn(cell: string): MenuColumn | null {
  const key = headerKey(cell);
  return MENU_COLUMNS.find((c) => HEADER_NAMES[c].includes(key)) ?? null;
}

/** For comparing names: "Flat  white " and "flat white" are one item. */
export function menuNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const YES = ["", "yes", "y", "true", "1", "available", "instock", "on"];
const NO = ["no", "n", "false", "0", "soldout", "unavailable", "off"];

function readAvailable(text: string): boolean | null {
  const key = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return YES.includes(key) ? true : NO.includes(key) ? false : null;
}

/** "4.50", "180", "1200": what a price looks like in this currency. */
function examplePrice(settings: ImportSettings): string {
  const digits = moneyDigits(settings);
  return digits === 0 ? "450" : `4.${"50".padEnd(digits, "0")}`;
}

/** The currency's narrow symbol in that locale ("$", "¥"), or its code. */
function narrowSymbol(currency: string, locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/**
 * How a price in the cafe's currency may be marked: its code, the symbols its
 * locale shows ("US$" in en-IN, "￥" in ja-JP), and the ones people type ("$",
 * "¥"). Longest first, so "US$" goes before "$" could leave "US".
 */
function currencyMarks(settings: ImportSettings): string[] {
  return [
    settings.currency,
    currencySymbol(settings),
    narrowSymbol(settings.currency, settings.locale),
    narrowSymbol(settings.currency, "en"),
  ].sort((a, b) => b.length - a.length);
}

/**
 * The typed price without the cafe's own symbol or code around it, nor zeros
 * past the currency's decimals: a spreadsheet's "180.00" is ¥180. Not three
 * of them, though: "1,000" or "1.000" is a thousand written with grouping,
 * and is refused rather than read as 1.
 */
function bare(text: string, settings: ImportSettings): string {
  let out = text.trim();
  for (const mark of currencyMarks(settings)) {
    if (out.startsWith(mark)) out = out.slice(mark.length).trim();
    if (out.endsWith(mark)) out = out.slice(0, -mark.length).trim();
  }
  const digits = moneyDigits(settings);
  const match = /^(\d*)[.,](\d*)$/.exec(out);
  if (match) {
    const [, units, fraction] = match;
    const extra = fraction.slice(digits);
    if (extra && /^0+$/.test(extra) && fraction.length !== 3) {
      out = digits === 0 ? units : `${units}.${fraction.slice(0, digits)}`;
    }
  }
  return out;
}

function readPrice(
  text: string,
  settings: ImportSettings,
): { price: number } | { problem: string } {
  if (text.trim() === "") return { problem: "Needs a price." };
  const price = parseMoneyInput(bare(text, settings), settings);
  if (price === null) {
    const digits = moneyDigits(settings);
    const how =
      digits === 0
        ? "a whole number"
        : `a number with up to ${digits} decimal${digits === 1 ? "" : "s"}`;
    return {
      problem: `"${text.trim()}" isn't a price in ${currencySymbol(settings)}: use ${how}, like ${examplePrice(settings)}.`,
    };
  }
  if (price === 0) return { problem: "Price has to be more than 0." };
  if (price > settings.maxOrderTotal) {
    return {
      problem: `${formatMoney(price, settings)} is more than one order may total (${formatMoney(settings.maxOrderTotal, settings)}), so nobody could order it.`,
    };
  }
  return { price };
}

/**
 * The header's columns, or null when the first row is an item. A header is a
 * row naming the `name` column; any column it doesn't know is left alone.
 */
function readHeader(row: CsvRow): (MenuColumn | null)[] | null {
  const columns = row.cells.map(headerColumn);
  return columns.includes("name") ? columns : null;
}

/** Checks every row of the text against the menu's rules, and the others. */
export function readMenuImport(
  text: string,
  settings: ImportSettings,
  options: ImportOptions = {},
): MenuImport {
  const all = parseCsv(text).filter((r) => r.cells.some((c) => c.trim()));
  const columns = all.length > 0 ? readHeader(all[0]) : null;
  const header = columns ? all[0] : null;
  const body = columns ? all.slice(1) : all;
  const layout = columns ?? [...MENU_COLUMNS];

  const onMenu = new Set((options.existingNames ?? []).map(menuNameKey));
  const categories = new Map<string, string>();
  for (const category of options.existingCategories ?? []) {
    categories.set(menuNameKey(category), category);
  }
  const seen = new Map<string, number>();

  const rows = body.map((csv, index): MenuImportRow => {
    const value = (column: MenuColumn) => {
      const at = layout.indexOf(column);
      return at < 0 ? "" : (csv.cells[at] ?? "").trim();
    };
    const problems: string[] = [];
    const name = value("name").replace(/\s+/g, " ");
    const category = value("category").replace(/\s+/g, " ");
    const description = value("description");

    if (!name) problems.push("Needs a name.");
    else if (name.length > MENU_TEXT_LIMITS.name) {
      problems.push(
        `Name is ${name.length} characters; the most is ${MENU_TEXT_LIMITS.name}.`,
      );
    }
    if (!category) problems.push("Needs a category.");
    else if (category.length > MENU_TEXT_LIMITS.category) {
      problems.push(
        `Category is ${category.length} characters; the most is ${MENU_TEXT_LIMITS.category}.`,
      );
    }
    const price = readPrice(value("price"), settings);
    if ("problem" in price) problems.push(price.problem);
    if (description.length > MENU_TEXT_LIMITS.description) {
      problems.push(
        `Description is ${description.length} characters; the most is ${MENU_TEXT_LIMITS.description}.`,
      );
    }
    const available = readAvailable(value("available"));
    if (available === null) {
      problems.push(
        `Available is "${value("available")}": use yes or no, or leave it empty for yes.`,
      );
    }
    if (name) {
      const key = menuNameKey(name);
      const first = seen.get(key);
      if (first !== undefined) problems.push(`Same name as row ${first}.`);
      else if (onMenu.has(key)) problems.push("Already on the menu.");
      seen.set(key, first ?? csv.row);
    }
    if (index >= MAX_IMPORT_ROWS) {
      problems.push(
        `Past the ${MAX_IMPORT_ROWS}-row limit: import these in a second go.`,
      );
    }

    let filed = category;
    if (category && problems.length === 0) {
      const key = menuNameKey(category);
      filed = categories.get(key) ?? category;
      categories.set(key, filed);
    }

    return {
      row: csv.row,
      start: csv.start,
      end: csv.end,
      name,
      problems,
      item:
        problems.length === 0 && "price" in price
          ? {
              name,
              category: filed,
              description,
              price: price.price,
              available: available ?? true,
            }
          : null,
    };
  });

  return {
    header,
    rows,
    items: rows.flatMap((r) => (r.item ? [r.item] : [])),
  };
}

/**
 * Items as CSV with a header, prices in the cafe's currency as a spreadsheet
 * column wants them ("180.00"). A null price is an empty cell, for the owner
 * to fill in.
 */
export function menuToCsv(
  items: readonly (Omit<MenuImportItem, "price"> & { price: number | null })[],
  settings: ImportSettings,
): string {
  return toCsv([
    [...MENU_COLUMNS],
    ...items.map((item) => [
      item.name,
      item.category,
      item.price === null
        ? ""
        : moneyToDecimal(item.price, settings, { padded: true }),
      item.description,
      item.available ? "yes" : "no",
    ]),
  ]);
}
