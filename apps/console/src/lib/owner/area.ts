/**
 * Which cafe the owner area shows, and where its pieces live: the cafe's own
 * dashboard and site. Pure, so it is tested without a browser.
 */

import type { Cafe } from "../platform/model";
import { isSiteName } from "../platform/validate";

/**
 * The cafe in the address (`?cafe=`) if it is one of the owner's; else the
 * oldest that is past setup; else the newest draft. `cafes` is oldest first.
 */
export function cafeToShow(
  cafes: readonly Cafe[],
  wanted: string | null,
): Cafe | null {
  const asked = wanted ? cafes.find((c) => c.id === wanted) : undefined;
  if (asked) return asked;
  const started = cafes.find((c) => c.status !== "draft");
  if (started) return started;
  return cafes.at(-1) ?? null;
}

/** The cafe's address on the web, or null if its name isn't a valid one. */
export function siteHost(site: string): string | null {
  return isSiteName(site) ? `${site}.web.app` : null;
}

/**
 * The cafe's own dashboard, in the owner's own project: menu, tables, orders
 * and staff. The cafe app serves it at /admin.
 */
export function dashboardUrl(site: string): string | null {
  const host = siteHost(site);
  return host ? `https://${host}/admin` : null;
}
