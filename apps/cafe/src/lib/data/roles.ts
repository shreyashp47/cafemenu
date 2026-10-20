/**
 * Turning a `/staff/{uid}` document into a role, the same way firestore.rules
 * does.
 *
 * The rules say an account is staff if the document *exists* (`isStaff()`), and
 * owner if its `role` is "owner". Anything else in `role` — a typo, a missing
 * field — is still staff, because the rules would still let that account work
 * the board. No document at all is `unassigned`: the rules refuse that account
 * everything, so the app shows it a "not set up yet" screen instead of an empty
 * board and a permissions error (issue #33).
 */

import type { StaffRole } from "./types";

export function roleFromStaffDoc(exists: boolean, data: unknown): StaffRole {
  if (!exists) return "unassigned";
  const role =
    typeof data === "object" && data !== null
      ? (data as { role?: unknown }).role
      : undefined;
  return role === "owner" ? "owner" : "staff";
}

/** The name to show in the board header: the staff doc's, else the email's. */
export function staffDisplayName(
  data: unknown,
  email: string | null | undefined,
): string {
  const name =
    typeof data === "object" && data !== null
      ? (data as { name?: unknown }).name
      : undefined;
  if (typeof name === "string" && name.trim()) return name.trim();
  return email?.split("@")[0] || "Staff";
}
