/**
 * Deploys a fixture cafe's settings into a build, as a preview: writes
 * <out>/site.json from fixtures/<name>.json with `"demo": true`, so the build
 * runs on the in-browser demo store as that cafe (src/lib/boot.ts). CI uses it
 * to run the browser checks as TOE Cafe (issue #18).
 *
 *   npm run build && node scripts/use-fixture.mjs toe        # writes out/site.json
 *
 * Never a real deploy: the demo flag is always set, and nothing here talks to
 * a Firebase project. The fixtures are checked against the strict settings
 * validator in src/lib/__tests__/fixtures.test.ts.
 */
import { writeFixtureSite } from "./lib/use-fixture.mjs";

const [name, outDir = "out"] = process.argv.slice(2);

try {
  const written = await writeFixtureSite(name, outDir);
  console.log(`site.json: ${written}`);
} catch (error) {
  console.error(
    `use-fixture: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
