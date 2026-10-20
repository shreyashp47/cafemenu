/**
 * Runs straight after `next build` (see "build" in package.json) and writes the
 * build's content hash into out/sw.js as its cache VERSION. See
 * scripts/lib/sw-version.mjs for why, and issue #29 for what went wrong
 * without it.
 *
 *   npm run build      # next build && node scripts/stamp-sw.mjs
 */
import { stampServiceWorker } from "./lib/sw-version.mjs";

const outDir = process.argv[2] ?? "out";

try {
  const version = await stampServiceWorker(outDir);
  console.log(`sw.js: cache version ${version}`);
} catch (error) {
  console.error(`sw.js: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
