/**
 * The starting menu on the sign-up form: one of the starter menus from
 * @cafemenu/shared, a blank menu, or a list the owner pastes or uploads,
 * read by the same import the cafe app's dashboard uses. What comes out is
 * the StartingMenu kept at `cafes/{id}/setup/menu` for provisioning to load.
 *
 * A starter is priced in the cafe's currency when @cafemenu/shared has a
 * price level for it. When it has none, its items come as CSV with empty
 * prices for the owner to fill in, through the import, rather than guessed.
 */

import {
  hasStarterPrices,
  readMenuImport,
  starterMenu,
  starterMenuCsv,
  starterPrice,
  STARTER_MENU_IDS,
  type ImportSettings,
  type MenuImportRow,
  type StarterMenuId,
} from "@cafemenu/shared";
import type { StartingMenu, StartingMenuItem } from "../platform/model";

export type MenuChoice =
  | { kind: "template"; id: StarterMenuId }
  | { kind: "blank" }
  | { kind: "import" };

export const isStarterId = (value: unknown): value is StarterMenuId =>
  (STARTER_MENU_IDS as readonly unknown[]).includes(value);

/**
 * Does this choice need the owner's list? A pasted one does; so does a
 * starter in a currency it has no prices for, which they then price.
 */
export function needsList(choice: MenuChoice, settings: ImportSettings) {
  return (
    choice.kind === "import" ||
    (choice.kind === "template" && !hasStarterPrices(settings))
  );
}

/**
 * The text to start the list with when it opens for a starter: its items
 * with empty prices. Empty for a pasted list.
 */
export function listStart(choice: MenuChoice, settings: ImportSettings) {
  return choice.kind === "template" ? starterMenuCsv(choice.id, settings) : "";
}

export interface MenuResult {
  /** What to store, when there is nothing to fix. */
  menu: StartingMenu | null;
  /** The rows of the list with what is wrong with each, when there is a list. */
  rows: MenuImportRow[];
  /** How many items the menu will start with. */
  count: number;
  /** A list with nothing in it, or rows to fix. */
  problem: "empty" | "rows" | null;
}

/**
 * The menu the form will store for `choice`, given the owner's list `text`
 * when the choice needs one. Every row must be right: at sign-up there is no
 * menu yet to keep the good rows in while the bad ones are fixed.
 */
export function startingMenu(
  choice: MenuChoice,
  text: string,
  settings: ImportSettings,
): MenuResult {
  const template = choice.kind === "template" ? choice.id : null;
  const source = choice.kind;
  if (choice.kind === "blank") {
    return {
      menu: { source, template, currency: settings.currency, items: [] },
      rows: [],
      count: 0,
      problem: null,
    };
  }
  if (choice.kind === "template" && hasStarterPrices(settings)) {
    const items: StartingMenuItem[] = starterMenu(choice.id).items.map(
      (item) => ({
        name: item.name,
        category: item.category,
        description: item.description,
        // Never null here: the currency has a price level.
        price: starterPrice(item.usdCents, settings) ?? 1,
        available: true,
      }),
    );
    return {
      menu: { source, template, currency: settings.currency, items },
      rows: [],
      count: items.length,
      problem: null,
    };
  }
  const read = readMenuImport(text, settings);
  const bad = read.rows.some((row) => row.problems.length > 0);
  const problem = read.rows.length === 0 ? "empty" : bad ? "rows" : null;
  return {
    menu: problem
      ? null
      : {
          source,
          template,
          currency: settings.currency,
          items: read.items,
        },
    rows: read.rows,
    count: read.items.length,
    problem,
  };
}
