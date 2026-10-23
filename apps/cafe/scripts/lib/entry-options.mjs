/**
 * What `scripts/entry.mjs` is told, from the command line and the environment,
 * so the same script checks the build in CI and any cafe's live address:
 *
 *   --url <address>        BASE_URL      the site to check; without one the
 *                                        script starts `next dev` itself
 *   --sw-version <v>       EXPECT_SW_VERSION
 *                                        the cache version /sw.js must carry
 *                                        (the one `npm run build` prints)
 *   --table <n>            ENTRY_TABLE   a table the cafe has (default 3, which
 *                                        the demo and TOE both have)
 *
 * A flag wins over its variable. Throws an Error that says what is wrong.
 */
import { parseArgs } from "node:util";

export const DEFAULT_TABLE = 3;
export const MAX_TABLE = 50;

export const USAGE = `Usage: node scripts/entry.mjs [--url <address>] [--sw-version <version>] [--table <n>]

  --url <address>        The site to check (or BASE_URL). Without one, starts
                         \`next dev\` and checks that.
  --sw-version <version> /sw.js must carry this cache version (or
                         EXPECT_SW_VERSION): proves the release just deployed
                         is the one being served.
  --table <n>            A table the cafe has (or ENTRY_TABLE), 1 to ${MAX_TABLE}.
                         Default ${DEFAULT_TABLE}.

Read-only: it navigates and reads pages, and never places an order.`;

/** {url, swVersion, table, help}; url and swVersion are null when not given. */
export function entryOptions(argv = [], env = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        url: { type: "string" },
        "sw-version": { type: "string" },
        table: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    throw new Error(error.message);
  }
  if (values.help) return { help: true, url: null, swVersion: null, table: 0 };

  const given = (flag, variable) =>
    (values[flag] ?? env[variable] ?? "").trim() || null;

  let url = given("url", "BASE_URL");
  if (url !== null) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Not an address: ${url}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error(`The address must be http or https: ${url}`);
    }
    url = url.replace(/\/+$/, "");
  }

  const swVersion = given("sw-version", "EXPECT_SW_VERSION");
  if (swVersion !== null && !/^[A-Za-z0-9._-]+$/.test(swVersion)) {
    throw new Error(`Not a cache version: ${swVersion}`);
  }

  const table = given("table", "ENTRY_TABLE") ?? String(DEFAULT_TABLE);
  if (!/^\d+$/.test(table) || +table < 1 || +table > MAX_TABLE) {
    throw new Error(`--table takes a whole number from 1 to ${MAX_TABLE}.`);
  }

  return { help: false, url, swVersion, table: Number(table) };
}

/**
 * What a menu looks like in text: a price, whatever the cafe's currency.
 * Intl writes most as a symbol beside the number ("₹120.00", "$4.50", "4,50 €")
 * and the rest as a code ("CHF 4.50").
 */
export const PRICE = /\p{Sc}\s*\d|\d\s*\p{Sc}|\b[A-Z]{3}\s*\d/u;
