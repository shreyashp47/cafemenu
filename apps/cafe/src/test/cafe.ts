/**
 * Which cafe the unit tests run as.
 *
 * By default the demo cafe, exactly as `npm run dev` boots: no init.json, no
 * site.json. With CAFE_FIXTURE set, a cafe from fixtures/ instead, deployed
 * as a preview (site.json with `"demo": true`), so every page test runs with
 * that cafe's settings on the demo store:
 *
 *   CAFE_FIXTURE=toe npm test      # TOE Cafe, what CI also runs (issue #18)
 *
 * Tests that look for the cafe's name or tables use SUITE_SETTINGS, not
 * DEFAULT_SETTINGS, so they hold under either.
 */

import { mergeCafeSettings, type CafeSettings } from "@cafemenu/shared";

import toe from "../../fixtures/toe.json";
import { primeBoot } from "@/lib/boot";

const FIXTURES: Record<string, Record<string, unknown>> = { toe };

const chosen = process.env.CAFE_FIXTURE?.trim() || null;
if (chosen && !(chosen in FIXTURES)) {
  throw new Error(
    `CAFE_FIXTURE=${chosen}: no such fixture. There is: ${Object.keys(FIXTURES).join(", ")}.`,
  );
}
const fixture = chosen ? FIXTURES[chosen] : null;

/** The fixture's name, or null for the demo cafe. */
export const SUITE_FIXTURE: string | null = chosen;

/** The settings every page in the suite shows unless a test sets its own. */
export const SUITE_SETTINGS: CafeSettings = mergeCafeSettings(fixture);

/** Settles the boot as the suite's cafe, for setup.ts and for tests that changed it. */
export function primeSuiteBoot(): void {
  primeBoot(
    fixture
      ? {
          backend: { kind: "demo" },
          site: { status: "ok", value: { settings: fixture, demo: true } },
        }
      : { backend: { kind: "demo" }, site: { status: "missing" } },
  );
}
