/**
 * Logic for `npm run cleanup:orders` (issue #31), kept apart from the CLI
 * wrapper so the date maths and the delete loop can be tested with a fake
 * client.
 *
 * requirements.md §5.4 asks for orders to be kept for "a minimum of 6 months".
 * The automatic way to enforce a ceiling on that — a Firestore TTL policy — needs
 * the Blaze plan, so retention is an operational practice here instead: the
 * owner runs this every so often. It is a dry run unless told otherwise, and it
 * refuses any cutoff that would delete an order younger than six months, so it
 * cannot be used to break the minimum the requirement actually sets.
 */
import { parseArgs } from "node:util";

import { UsageError } from "./admin-client.mjs";

export const MIN_MONTHS = 6;
/** Firestore's batchWrite takes up to 500; smaller keeps each request quick. */
export const BATCH = 300;

export const CLEANUP_USAGE = `Usage:
  npm run cleanup:orders -- [--older-than=6m] [--confirm]

Deletes orders created before a cutoff. Without --confirm it only counts them.

Options:
  --older-than=<age>   How old an order must be to go: 6m, 9m, 1y, 200d …
                       (default 6m; anything under six months is refused,
                       because requirements.md §5.4 keeps at least that long)
  --confirm            Actually delete. Without it this is a dry run.
  --dry-run            Say so explicitly (it is the default anyway)
  --project=<id>       Firebase project (default: "default" in .firebaserc)
  --help               Show this

Export the months you want to keep from /admin/reports (CSV) first: deleted
orders disappear from the reports too.`;

/** "6m" -> { amount: 6, unit: "m" }. Throws UsageError. */
export function parseAge(value) {
  const match = /^(\d{1,4})([dmy])$/.exec(String(value ?? "").trim());
  if (!match || Number(match[1]) === 0) {
    throw new UsageError(
      `--older-than must look like 6m, 1y or 200d, not "${value}".`,
    );
  }
  return { amount: Number(match[1]), unit: match[2] };
}

/**
 * `date` minus `months` calendar months, in UTC, clamping the day so that
 * 31 August minus six months is the last day of February, not 3 March.
 */
export function subtractMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The instant before which orders are deleted. */
export function cutoffFor(age, now) {
  if (age.unit === "d")
    return new Date(now.getTime() - age.amount * 86_400_000);
  const months = age.unit === "y" ? age.amount * 12 : age.amount;
  return subtractMonths(now, months);
}

export function parseCleanupArgs(argv, now = new Date()) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        "older-than": { type: "string", default: `${MIN_MONTHS}m` },
        confirm: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        project: { type: "string" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { help: true };

  if (values.confirm && values["dry-run"]) {
    throw new UsageError("--confirm and --dry-run contradict each other.");
  }

  const age = parseAge(values["older-than"]);
  const cutoff = cutoffFor(age, now);
  const floor = subtractMonths(now, MIN_MONTHS);
  if (cutoff > floor) {
    throw new UsageError(
      `--older-than=${values["older-than"]} would delete orders placed after ` +
        `${floor.toISOString().slice(0, 10)}. requirements.md §5.4 keeps at ` +
        `least ${MIN_MONTHS} months, so the youngest allowed is ${MIN_MONTHS}m.`,
    );
  }

  return {
    help: false,
    olderThan: values["older-than"],
    cutoff,
    confirm: values.confirm,
    project: values.project,
  };
}

const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : "?");

/**
 * Counts, then (with `confirm`) deletes oldest-first in batches until nothing
 * before the cutoff is left. Returns `{ found, deleted }`.
 */
export async function runCleanup(opts, client, log = console.log) {
  const count = await client.countOrdersBefore(opts.cutoff);
  const [oldest] =
    count > 0 ? await client.listOrdersBefore(opts.cutoff, 1) : [];

  log(
    `${opts.confirm ? "" : "[dry run] "}Orders on ${client.target} created before ` +
      `${day(opts.cutoff)} (older than ${opts.olderThan}): ${count}` +
      (count > 0 ? `, the oldest from ${day(oldest?.createdAt)}.` : "."),
  );

  if (count === 0) {
    log("Nothing to delete.");
    return { found: 0, deleted: 0 };
  }
  if (!opts.confirm) {
    log(
      "Dry run: nothing was deleted. Export those months from /admin/reports " +
        "first if you want to keep the figures, then re-run with --confirm.",
    );
    return { found: count, deleted: 0 };
  }

  let deleted = 0;
  let lastFirst = null;
  for (;;) {
    const page = await client.listOrdersBefore(opts.cutoff, BATCH);
    if (page.length === 0) break;
    // A page that starts where the last one did means the deletes are not
    // landing. Stop rather than spin.
    if (page[0].name === lastFirst) {
      throw new Error(
        `Deletes are not taking effect (stuck at ${page[0].name}). Stopped after ${deleted}.`,
      );
    }
    lastFirst = page[0].name;
    await client.deleteDocuments(page.map((row) => row.name));
    deleted += page.length;
    log(`Deleted ${deleted} of ~${count}…`);
  }
  log(`Done: deleted ${deleted} orders created before ${day(opts.cutoff)}.`);
  return { found: count, deleted };
}
