/**
 * The package layout both package.mjs and verify.mjs agree on. docs/releases.md
 * describes it for people.
 */

export const PACKAGE_NAME = "cafemenu-cafe";

/** Bumped only if the layout or release.json changes in a way verify must know. */
export const FORMAT = 1;

export const MANIFEST = "release.json";
export const SUMS = "SHA256SUMS";
export const NOTES = "NOTES.md";

/** What a package cannot be deployed without. */
export const REQUIRED = [
  "site/index.html",
  "firestore.rules",
  "firestore.indexes.json",
  "firebase.json",
];
