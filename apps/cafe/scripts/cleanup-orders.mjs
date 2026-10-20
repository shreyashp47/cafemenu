/**
 * Owner-run order retention (issue #31). A dry run unless given --confirm.
 *
 *   npm run cleanup:orders                          # count orders older than 6 months
 *   npm run cleanup:orders -- --older-than=1y       # count orders older than a year
 *   npm run cleanup:orders -- --older-than=1y --confirm   # delete them
 *
 * Runs as whoever is logged in to the Firebase CLI (`firebase login`); see
 * scripts/lib/admin-client.mjs. Why this is a script and not a TTL policy:
 * docs/decisions.md, "Order retention".
 */
import { UsageError, connect } from "./lib/admin-client.mjs";
import {
  CLEANUP_USAGE,
  parseCleanupArgs,
  runCleanup,
} from "./lib/cleanup-orders.mjs";

try {
  const opts = parseCleanupArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(CLEANUP_USAGE);
  } else {
    const client = await connect({ projectFlag: opts.project });
    await runCleanup(opts, client);
  }
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${CLEANUP_USAGE}`);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
