/**
 * The checks the console asks of the outside world, which only the backend
 * can really make: whether a web address name is free. Kept apart from the
 * Firebase adapters, so demo mode does not download the SDK to use them.
 */

import type { SiteAvailability, SiteNameChecker } from "./types";

/**
 * Names demo mode and the emulators pretend are taken, so the "taken" path
 * and its suggestions can be seen without a real Firebase. Short, common
 * words like these are all long gone in real Firebase too.
 */
export const SIMULATED_TAKEN_SITES: readonly string[] = [
  "cafe",
  "coffee",
  "menu",
  "demo",
  "test",
  "my-cafe",
  "the-cafe",
  "coffee-shop",
  "cafemenu",
];

/**
 * The stand-in for demo mode and the emulators: taken when the name is in
 * the list above or already used by a cafe in this store.
 */
export function simulatedSiteChecker(
  sitesInUse: () => readonly string[] = () => [],
): SiteNameChecker {
  return {
    async check(site): Promise<SiteAvailability> {
      const taken =
        SIMULATED_TAKEN_SITES.includes(site) || sitesInUse().includes(site);
      return taken ? "taken" : "looks-free";
    },
  };
}

/**
 * Against the real platform. A browser cannot tell: *.web.app answers every
 * name, taken or not, with no CORS headers to read the answer by.
 *
 * TODO(#28): ask the backend, which tries a validate-only `sites.create` in
 * the platform's own project, as `deployer provision` does when it looks for
 * free names near a taken one (packages/deployer/src/commands/provision.mjs).
 * Until then every name is "unknown", and provisioning makes the only check.
 */
export const pendingSiteChecker: SiteNameChecker = {
  async check() {
    return "unknown";
  },
};
