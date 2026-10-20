/**
 * Logic for `npm run seed:staff` (issue #33), kept apart from the CLI wrapper so
 * it can be tested with a fake client.
 *
 * Setting up a barista used to mean: create the user in the Auth console, copy
 * the uid, open the Firestore console, create /staff/{uid} in a collection that
 * may not exist yet, and type JSON. This does all of that from one command, and
 * is safe to re-run — an existing account keeps its password, and only `name`
 * and `role` on the staff document are written.
 */
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";

import { UsageError } from "./admin-client.mjs";

export const SEED_USAGE = `Usage:
  npm run seed:staff -- --email=<email> --role=staff|owner [options]

Options:
  --name=<name>        Name shown on the board (default: the account's, or the
                       part of the email before the @)
  --password=<pw>      Password for a NEW account (at least 8 characters).
                       Omit it to have one generated and printed once.
  --project=<id>       Firebase project (default: "default" in .firebaserc)
  --dry-run            Look everything up and say what would change, but
                       write nothing
  --help               Show this

An existing account keeps its password; only its /staff document is written.`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parses argv (without node and the script path). Throws UsageError. */
export function parseSeedArgs(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        email: { type: "string" },
        role: { type: "string" },
        name: { type: "string" },
        password: { type: "string" },
        project: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { help: true };

  const email = values.email?.trim().toLowerCase();
  if (!email) throw new UsageError("--email is required.");
  if (!EMAIL.test(email)) throw new UsageError(`Not an email: ${email}`);

  const role = values.role?.trim().toLowerCase();
  if (role !== "staff" && role !== "owner") {
    throw new UsageError("--role must be staff or owner.");
  }

  const name = values.name?.trim();
  if (values.name !== undefined && (!name || name.length > 80)) {
    throw new UsageError("--name must be 1 to 80 characters.");
  }

  // Firebase's own floor is 6; a counter phone's login deserves a bit more.
  if (values.password !== undefined && values.password.length < 8) {
    throw new UsageError("--password must be at least 8 characters.");
  }

  return {
    help: false,
    email,
    role,
    name,
    password: values.password,
    project: values.project,
    dryRun: values["dry-run"],
  };
}

// No 0/O, 1/l/I: this gets read off one screen and typed into a phone.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. "Hq7k-mZ3p-Rt9w": 12 random characters, ~69 bits, in typeable groups. */
export function generatePassword(pick = (n) => randomInt(n)) {
  const chars = Array.from(
    { length: 12 },
    () => ALPHABET[pick(ALPHABET.length)],
  );
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/**
 * Works out what to do, then does it unless `dryRun`. Returns a summary; all
 * user-facing text goes through `log`. The generated password, if any, is
 * logged exactly once and never stored.
 */
export async function runSeed(opts, client, log = console.log) {
  const prefix = opts.dryRun ? "[dry run] " : "";
  log(`${prefix}Setting up ${opts.email} as ${opts.role} on ${client.target}.`);

  const existing = await client.lookupUserByEmail(opts.email);
  let uid = existing?.uid ?? null;
  let generated = null;
  let createdUser = false;

  if (existing) {
    log(`Auth: account exists (uid ${existing.uid}). Password left unchanged.`);
    if (opts.password) {
      log(
        "  (--password was ignored: this never resets an existing password.)",
      );
    }
  } else if (opts.dryRun) {
    log("Auth: no account with that email. Would create one.");
  } else {
    const password = opts.password ?? (generated = generatePassword());
    const displayName = opts.name ?? opts.email.split("@")[0];
    ({ uid } = await client.createUser({
      email: opts.email,
      password,
      displayName,
    }));
    createdUser = true;
    log(`Auth: created account (uid ${uid}).`);
  }

  const current = uid ? await client.getStaffDoc(uid) : null;
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const name =
    opts.name ??
    text(current?.name) ??
    text(existing?.displayName) ??
    opts.email.split("@")[0];
  const unchanged =
    current && current.role === opts.role && current.name === name;

  if (unchanged) {
    log(`Firestore: /staff/${uid} already says ${opts.role}. Nothing to do.`);
  } else {
    const what = current
      ? `update /staff/${uid}: role ${current.role ?? "(none)"} -> ${opts.role}, name "${name}"`
      : `create /staff/${uid ?? "<new uid>"} { name: "${name}", role: "${opts.role}" }`;
    if (opts.dryRun) {
      log(`Firestore: would ${what}.`);
    } else {
      await client.setStaffDoc(uid, { name, role: opts.role });
      log(`Firestore: ${what.replace(/^(\w)/, (c) => c.toUpperCase())}. Done.`);
    }
  }

  if (generated) {
    log("");
    log(`Password (shown once, not saved anywhere): ${generated}`);
    log("Give it to them directly. They sign in at /staff with this email.");
  }
  if (opts.dryRun) log("\nDry run: nothing was written.");

  return {
    uid,
    createdUser,
    wroteDoc: !opts.dryRun && !unchanged,
    generatedPassword: generated,
  };
}
