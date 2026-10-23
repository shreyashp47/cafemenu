/**
 * Schema 1 → 2: TOE's whole rupees become paise (#21), as
 * apps/cafe/docs/decisions.md ("Any currency") plans it.
 *
 * Every amount is multiplied by 10 to the currency's digits (100 for INR):
 * menu/*.price, orders/*.total and every orders/*.items[].price. Then
 * config/site says so: settings schema 2, "moneyUnit": "minor", and the cap
 * in paise, 1,000,000. Open pages follow config/site live, so that last write
 * is the switch. Until it lands, migrated amounts show 100 times too large and
 * the rules still cap an order at 10,000 of them: big orders are refused and
 * nothing is undercharged. That window is why this runs while the cafe is
 * closed (`deployer migrate`), and why migrations/schema.json's
 * minSchemaVersion is 2: no release from before it may run on paise.
 *
 * A cafe whose config/site already counts minor units (every cafe but TOE)
 * has no amounts to change. Nothing else is read or written: not
 * dayCounters, tableKeys, staff, or anything outside menu, orders and
 * config/site.
 */
export const from = 1;
export const to = 2;
export const describe =
  "whole currency units to minor ones (TOE's rupees to paise): menu prices, order totals and line prices, then config/site";

// A cafe with no config/site is TOE from before CafeMenu: rupees, with the
// 10,000 cap the rules have always applied.
const LEGACY = { currency: "INR", locale: "en-IN", maxOrderTotal: 10000 };

/** The currency's decimal places, as @cafemenu/shared's currencyDigits works them out. */
function currencyDigits(currency, locale) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/** Settings schema 2 saying "minor"; schema 1 is whole units whatever it says (LEGACY_MONEY). */
const countsMinor = (site) =>
  site?.schemaVersion !== 1 && site?.moneyUnit === "minor";

export async function up(db) {
  const site = await db.get("config/site");
  if (countsMinor(site)) {
    db.log.same("config/site already counts minor units: no amounts to change");
    return;
  }
  const currency = site?.currency ?? LEGACY.currency;
  const factor = 10 ** currencyDigits(currency, site?.locale ?? LEGACY.locale);
  const cap =
    site?.schemaVersion !== 1 && Number.isSafeInteger(site?.maxOrderTotal)
      ? site.maxOrderTotal
      : LEGACY.maxOrderTotal;
  const times = (amount) =>
    typeof amount === "number" && Number.isFinite(amount)
      ? Math.round(amount * factor)
      : amount;
  const said = (would, done) => db.log.change(db.dryRun ? would : done);
  const late = (state, what) => {
    if (state.late)
      db.log.warn(
        `${state.late} ${what} created after the migration started (${db.startedAt}) were left as they are: check their amounts by hand`,
      );
  };

  const menu = await db.each("menu", "menu", (item) =>
    typeof item.price === "number" ? { price: times(item.price) } : null,
  );
  said(
    `menu: would multiply ${menu.changed} of ${menu.seen} prices by ${factor}`,
    `menu: multiplied ${menu.changed} of ${menu.seen} prices by ${factor}`,
  );
  late(menu, "menu items");

  let lines = 0;
  const orders = await db.each("orders", "orders", (order) => {
    const fields = {};
    if (typeof order.total === "number") fields.total = times(order.total);
    if (Array.isArray(order.items)) {
      fields.items = order.items.map((line) =>
        typeof line?.price === "number"
          ? { ...line, price: times(line.price) }
          : line,
      );
      lines += order.items.length;
    }
    return Object.keys(fields).length ? fields : null;
  });
  said(
    `orders: would multiply the totals and line prices of ${orders.changed} of ${orders.seen} orders by ${factor}${lines ? ` (${lines} lines)` : ""}`,
    `orders: multiplied the totals and line prices of ${orders.changed} of ${orders.seen} orders by ${factor}`,
  );
  late(orders, "orders");

  const maxOrderTotal = cap * factor;
  await db.update("site", "config/site", () => ({
    schemaVersion: 2,
    moneyUnit: "minor",
    maxOrderTotal,
  }));
  said(
    `config/site: would set "moneyUnit": "minor", "maxOrderTotal": ${maxOrderTotal}`,
    `config/site: "moneyUnit": "minor", "maxOrderTotal": ${maxOrderTotal}`,
  );
  db.log.info(
    "site.json follows on the next deploy or sync-branding; open pages go by config/site already",
  );
}
