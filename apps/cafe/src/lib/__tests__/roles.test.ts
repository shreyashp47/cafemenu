/**
 * The app's reading of /staff/{uid} must agree with firestore.rules, or the UI
 * and the database disagree about who is staff — which is how "signed in, empty
 * board" happened (issue #33).
 */

import { describe, expect, it } from "vitest";

import { roleFromStaffDoc, staffDisplayName } from "@/lib/data/roles";

describe("roleFromStaffDoc", () => {
  it("a missing document is unassigned, not staff", () => {
    expect(roleFromStaffDoc(false, undefined)).toBe("unassigned");
  });

  it("reads owner and staff", () => {
    expect(roleFromStaffDoc(true, { role: "owner" })).toBe("owner");
    expect(roleFromStaffDoc(true, { role: "staff" })).toBe("staff");
  });

  it("treats any existing document as staff, as isStaff() in the rules does", () => {
    expect(roleFromStaffDoc(true, {})).toBe("staff");
    expect(roleFromStaffDoc(true, { role: "Owner" })).toBe("staff");
    expect(roleFromStaffDoc(true, undefined)).toBe("staff");
  });
});

describe("staffDisplayName", () => {
  it("prefers the name on the staff document", () => {
    expect(staffDisplayName({ name: " Asha " }, "a@cafe.com")).toBe("Asha");
  });

  it("falls back to the email's local part, then to Staff", () => {
    expect(staffDisplayName({ name: "" }, "asha@cafe.com")).toBe("asha");
    expect(staffDisplayName(undefined, null)).toBe("Staff");
  });
});
