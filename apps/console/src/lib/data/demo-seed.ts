/**
 * What demo mode starts with: a few sample releases, so a release picker has
 * something to show. They are not real CafeMenu releases.
 */

import type { Release } from "../platform/model";

const day = (iso: string) => Date.parse(`${iso}T09:00:00Z`);

export const SEED_RELEASES: Release[] = [
  {
    version: "1.2.0-beta.1",
    channel: "beta",
    notes: "Sample release for demo mode. A beta: beta cafes get it first.",
    publishedAt: day("2026-10-12"),
    schemaVersion: 3,
    withdrawn: false,
  },
  {
    version: "1.1.1",
    channel: "stable",
    notes:
      "Sample release for demo mode. A patch: it reaches cafes staying on 1.1 too.",
    publishedAt: day("2026-10-05"),
    schemaVersion: 2,
    withdrawn: false,
  },
  {
    version: "1.1.0",
    channel: "stable",
    notes: "Sample release for demo mode.",
    publishedAt: day("2026-09-28"),
    schemaVersion: 2,
    withdrawn: false,
  },
  {
    version: "1.0.0",
    channel: "stable",
    notes: "Sample release for demo mode.",
    publishedAt: day("2026-09-01"),
    schemaVersion: 1,
    withdrawn: false,
  },
];
