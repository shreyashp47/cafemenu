/**
 * Create a staff or owner account, and its /staff/{uid} role document, in one
 * command (issue #33).
 *
 *   npm run seed:staff -- --email=asha@cafe.com --role=staff --name=Asha
 *   npm run seed:staff -- --email=you@cafe.com --role=owner --dry-run
 *
 * Runs as whoever is logged in to the Firebase CLI (`firebase login`), which
 * must be an owner or editor of the project. See scripts/lib/admin-client.mjs
 * for how, and why it is not firebase-admin. `--help` lists every option.
 */
import { UsageError, connect } from "./lib/admin-client.mjs";
import { SEED_USAGE, parseSeedArgs, runSeed } from "./lib/seed-staff.mjs";

try {
  const opts = parseSeedArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(SEED_USAGE);
  } else {
    const client = await connect({
      projectFlag: opts.project,
      needsAuth: true,
    });
    await runSeed(opts, client);
  }
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${SEED_USAGE}`);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
