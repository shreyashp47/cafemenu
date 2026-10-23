/**
 * The web address name: "lantern-cafe" serves lantern-cafe.web.app. It must
 * be a Hosting site ID (SITE_NAME in ../platform/validate.ts), and it must be
 * free across all of Firebase, which only provisioning can be sure of
 * (PLAN.md, "Web address"). Here: what it should look like, a name made from
 * the cafe's, and nearby names to offer when one is taken.
 */

import { SITE_NAME } from "../platform/validate";

export const SITE_NAME_MAX = 30;

/** Why a name is not a site ID, most useful first; null when it is one. */
export type SiteNameProblem =
  "empty" | "too-long" | "characters" | "hyphen-ends";

export function siteNameProblem(name: string): SiteNameProblem | null {
  if (name === "") return "empty";
  if (!/^[a-z0-9-]*$/.test(name)) return "characters";
  if (name.length > SITE_NAME_MAX) return "too-long";
  if (name.startsWith("-") || name.endsWith("-")) return "hyphen-ends";
  // Everything SITE_NAME refuses is one of the above.
  return SITE_NAME.test(name) ? null : "characters";
}

/** Within the limit, with no hyphen left dangling where it was cut. */
function fit(name: string, max = SITE_NAME_MAX): string {
  return name.slice(0, max).replace(/-+$/, "");
}

/**
 * A site name from a cafe's name: "Lantern Café & Bakery" is
 * "lantern-cafe-and-bakery". Accents go, "&" is "and", apostrophes vanish
 * ("Alice's" is "alices"), anything else is a hyphen. Empty for a name with
 * no Latin letters or digits at all, for the owner to type one.
 */
export function siteNameFrom(cafeName: string): string {
  const slug = cafeName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
  return fit(slug);
}

/** A small, stable number for a name, so suggestions do not reshuffle. */
function numberFor(name: string): number {
  let hash = 7;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  return 10 + (hash % 90);
}

/**
 * Up to `count` names near `name` to offer instead: with "-cafe", "-menu",
 * the country, "-orders", or a number on the end, cut to fit, never `name`
 * itself or one in `avoid`. What `deployer provision` tries when a name is
 * taken at setup, with the country as one more hint.
 */
export function siteSuggestions(
  name: string,
  {
    country,
    avoid = [],
    count = 3,
  }: {
    country?: string | null;
    avoid?: readonly string[];
    count?: number;
  } = {},
): string[] {
  const base = siteNameFrom(name);
  if (!base) return [];
  const endings = [
    /-(cafe|coffee)$/.test(base) ? "" : "cafe",
    "menu",
    country && /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : "",
    "orders",
    String(numberFor(base)),
  ].filter(Boolean);
  const out: string[] = [];
  for (const ending of endings) {
    const suffix = `-${ending}`;
    const candidate = `${fit(base, SITE_NAME_MAX - suffix.length)}${suffix}`;
    if (
      candidate !== name &&
      SITE_NAME.test(candidate) &&
      !avoid.includes(candidate) &&
      !out.includes(candidate)
    ) {
      out.push(candidate);
    }
    if (out.length === count) break;
  }
  return out;
}
