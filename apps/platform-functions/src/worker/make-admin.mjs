#!/usr/bin/env node
/**
 * Makes the first super admin (#78, docs/super-admin-requirements.md 3.5):
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=~/cafemenu-deploy.json \
 *     npm run make-admin -w @cafemenu/platform-functions -- --email you@example.com
 *
 * Sets the `admin` claim on the CafeMenu account with that email (it must
 * have signed up), marks it in the owners directory, and writes the admin
 * log's first entry. From then on admins appoint admins from the admin page,
 * through the backend, when the policy allows (APPOINT_OTHER_ADMINS).
 * `--remove` takes the claim away again.
 *
 * Run once, by the maintainer, on their own machine, with the platform
 * service account's key (or against the emulators, like the worker). The
 * account must sign out and in again to have the claim.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { workerEnv } from "./env.mjs";
import { createPublicLog } from "./log.mjs";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    remove: { type: "boolean", default: false },
  },
});
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: make-admin --email <the account's email> [--remove]");
  process.exit(2);
}

const { log } = createPublicLog({ write: (line) => console.error(line) });
let env;
try {
  env = await workerEnv({ log });
} catch (error) {
  console.error(`Couldn't start: ${error.message}`);
  process.exit(1);
}

const account = await env.store.findAccountByEmail(email);
if (!account) {
  console.error(
    `No CafeMenu account has the email ${email}: sign up on the console first.`,
  );
  process.exit(1);
}
const admin = !values.remove;
await env.store.setAdminClaim(account.uid, admin);
await env.store.setOwnerRecord(account.uid, { admin, email });
await env.store.addAdminLog(`command-line-${randomUUID()}`, {
  at: env.now(),
  by: "command-line",
  byEmail: null,
  action: admin ? "appoint-admin" : "remove-admin",
  cafeId: null,
  ownerUid: null,
  reason: { code: null, note: "make-admin, from the command line" },
  details: { uid: account.uid, email },
  requestId: null,
});
console.log(
  admin
    ? `${email} is an admin. Sign out of the console and in again to use /admin.`
    : `${email} is no longer an admin.`,
);
process.exit(0);
