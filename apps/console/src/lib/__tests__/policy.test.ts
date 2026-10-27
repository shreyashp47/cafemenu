/**
 * firestore.rules can't import @cafemenu/shared, so the lists it repeats
 * (the admin's reasons, the kinds of request) are checked against the
 * shared modules here: change one without the other and this fails.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAINTENANCE_REASONS,
  REACTIVATION_REASONS,
  SUSPENSION_REASONS,
} from "@cafemenu/shared/admin-policy";
import {
  ADMIN_REQUEST_KINDS,
  CAFELESS_REQUEST_KINDS,
  OWNER_REQUEST_KINDS,
} from "@cafemenu/shared/requests";
import { describe, expect, it } from "vitest";

const rules = readFileSync(join(__dirname, "../../../firestore.rules"), "utf8");

/** The quoted strings in the first `[...]` after `marker`. */
function listAfter(marker: string): string[] {
  const at = rules.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = rules.indexOf("[", at);
  const close = rules.indexOf("]", open);
  return [...rules.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("firestore.rules and the admin's policy", () => {
  it("have the same reasons to suspend, to reactivate and for maintenance", () => {
    expect(listAfter("function suspensionReasons()")).toEqual([
      ...SUSPENSION_REASONS,
    ]);
    expect(listAfter("function reactivationReasons()")).toEqual([
      ...REACTIVATION_REASONS,
    ]);
    expect([
      ...listAfter("function suspensionReasons()"),
      ...listAfter("function maintenanceReasons()"),
    ]).toEqual([...MAINTENANCE_REASONS]);
  });

  it("let owners ask for their kinds, and only the admin for the rest", () => {
    expect(
      listAfter("// An owner's, for their own cafe; or the admin's, for any."),
    ).toEqual([...OWNER_REQUEST_KINDS]);
    expect(
      listAfter("// The admin's alone, about a cafe and its owner."),
    ).toEqual(
      ADMIN_REQUEST_KINDS.filter((k) => !CAFELESS_REQUEST_KINDS.includes(k)),
    );
    expect(
      listAfter("// The admin's alone, about an account: no cafe."),
    ).toEqual([...CAFELESS_REQUEST_KINDS]);
  });
});
