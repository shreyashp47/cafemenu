/**
 * The starting menu, from the owner's sign-up (`cafes/{id}/setup/menu`) into
 * the cafe's own project, as the cafe app's menu import writes it
 * (apps/cafe/src/lib/data/firestore.ts, importItems): one `menu/{id}`
 * document per item, in order.
 *
 * Safe to run again. The items get fixed ids and go in one atomic commit
 * together with a marker, `config/setup`, so a second run finds the marker
 * and leaves the menu alone, even after the owner has edited it.
 *
 * The cafe's tables need no seeding: they are `tables` in the settings the
 * first deploy writes to `config/site`, which the app uses until the owner
 * saves a list of their own (`config/tables`). Writing that list here would
 * pin it, and a later change to the table count in the console would no
 * longer reach the cafe.
 */
import { ActionNeededError, firestore } from "@cafemenu/deployer";

const { commit, documentName, encodeFields, getDocument, decodeFields } =
  firestore;

export const SETUP_DOC = "config/setup";
const SITE_DOC = "config/site";

const textOf = (value, max, min = 0) =>
  typeof value === "string" && value.length >= min && value.length <= max;

/** One row against the limits of the cafe app's menu import (@cafemenu/shared). */
function itemProblem(item, shared) {
  const { name, category, description } = shared.MENU_TEXT_LIMITS;
  const ok =
    item &&
    textOf(item.name, name, 1) &&
    textOf(item.category, category, 1) &&
    textOf(item.description, description) &&
    Number.isSafeInteger(item.price) &&
    item.price > 0 &&
    typeof item.available === "boolean";
  return ok ? null : `"${String(item?.name ?? "").slice(0, 30)}"`;
}

/**
 * Loads `menu` into the cafe's project. Returns {seeded, items}: seeded is
 * false when an earlier run already did it.
 */
export async function seedStartingMenu(ctx, { menu, settings, shared }) {
  const { api, log, project } = ctx;
  log.step("Starting menu");

  if (!menu) {
    log.same("none was chosen at sign-up");
    return { seeded: false, items: 0 };
  }
  if (menu.currency !== settings.currency) {
    throw new ActionNeededError(
      `The starting menu is priced in ${menu.currency}, but the cafe's currency is now ${settings.currency}.`,
      {
        hint: "Choose the menu again in the cafe's settings, so its prices are in the cafe's currency.",
      },
    );
  }
  const items = Array.isArray(menu.items) ? menu.items : [];
  const bad = items.map((i) => itemProblem(i, shared)).filter(Boolean);
  if (bad.length || items.length > shared.MAX_IMPORT_ROWS) {
    throw new ActionNeededError(
      bad.length
        ? `These items in the starting menu can't be used: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? " and more" : ""}.`
        : `The starting menu has ${items.length} items; at most ${shared.MAX_IMPORT_ROWS} can be loaded.`,
      { hint: "Fix the menu in the cafe's settings." },
    );
  }

  const marker = await getDocument(api, project, SETUP_DOC);
  if (marker) {
    log.same("already loaded; the menu is left as it is now");
    return { seeded: false, items: items.length };
  }

  // Prices are stored in the unit the cafe's data counts in. The starting
  // menu is in minor units, which is what every new cafe counts in.
  const site = await getDocument(api, project, SITE_DOC);
  const unit = site ? decodeFields(site.fields).moneyUnit : null;
  if (unit !== "minor") {
    throw new ActionNeededError(
      `The cafe's data counts prices in ${unit ?? "an unknown unit"}, not minor units, so the starting menu can't be loaded as it is.`,
      { hint: "Tell the CafeMenu maintainer." },
    );
  }

  const create = (path, fields) => ({
    update: {
      name: documentName(project, path),
      fields: encodeFields(fields),
    },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { exists: false },
  });
  const writes = items.map((item, index) =>
    create(`menu/start-${String(index + 1).padStart(3, "0")}`, {
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      available: item.available,
      art: null,
      sortOrder: (index + 1) * 10,
    }),
  );
  writes.push(
    create(SETUP_DOC, {
      menuSource: menu.source,
      menuItems: items.length,
      menuLoadedAt: (ctx.now?.() ?? new Date()).toISOString(),
    }),
  );
  await commit(api, project, writes);
  log.change(
    items.length
      ? `loaded ${items.length} menu item${items.length === 1 ? "" : "s"}`
      : "recorded a blank menu",
  );
  return { seeded: true, items: items.length };
}
