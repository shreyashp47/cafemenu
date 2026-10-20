import { describe, expect, it } from "vitest";

import { friendlyError } from "../place-order";

/**
 * A customer at table 4 should never see "Firebase: Error
 * (auth/configuration-not-found)". These strings are the only thing standing
 * between a half-finished Firebase setup and a support call, so each one is
 * pinned rather than eyeballed.
 */
describe("friendlyError", () => {
  it("explains an unconfigured project as a setup step, not a broken app", () => {
    expect(
      friendlyError(
        new Error("Firebase: Error (auth/configuration-not-found)."),
      ),
    ).toBe("Ordering is not switched on yet. Please tell the counter.");
  });

  it("maps a domain that is not on the authorised list", () => {
    expect(
      friendlyError(new Error("Firebase: Error (auth/unauthorized-domain).")),
    ).toContain("not switched on for this address");
  });

  it("distinguishes a wifi problem from a kitchen problem", () => {
    expect(
      friendlyError(
        new Error("Firebase: Error (auth/network-request-failed)."),
      ),
    ).toMatch(/no connection/i);
    expect(friendlyError(new Error("Firebase: Error (unavailable)."))).toMatch(
      /busy/i,
    );
  });

  it("sends a permission or timeout failure back to the counter", () => {
    expect(
      friendlyError(new Error("Firebase: Error (permission-denied).")),
    ).toMatch(/tell the counter/i);
    expect(
      friendlyError(new Error("Firebase: Error (deadline-exceeded).")),
    ).toMatch(/too long/i);
  });

  it("reads the code off a Firestore error, whose message has none", () => {
    // The shape FirestoreError actually has: the code is a property, and the
    // message is prose. Every phone still on the old app after the rules change
    // gets exactly this, and must not see the raw text.
    const denied = Object.assign(
      new Error("Missing or insufficient permissions."),
      { code: "permission-denied", name: "FirebaseError" },
    );
    expect(friendlyError(denied)).toBe(
      "We couldn't send that order. Please tell the counter.",
    );
    const busy = Object.assign(new Error("The service is unavailable."), {
      code: "unavailable",
    });
    expect(friendlyError(busy)).toMatch(/busy/i);
  });

  it("still reads an auth code carried on the error", () => {
    const err = Object.assign(new Error("Firebase: Error."), {
      code: "auth/network-request-failed",
    });
    expect(friendlyError(err)).toMatch(/no connection/i);
  });

  it("does not swallow a message that is already meant for a person", () => {
    // OrderRejected produces these, and they are written to be read by a customer.
    expect(friendlyError(new Error("One for the road? is sold out."))).toBe(
      "One for the road? is sold out.",
    );
  });

  it("always returns something when handed nothing useful", () => {
    expect(friendlyError(undefined)).toMatch(/try again/i);
    expect(friendlyError(new Error(""))).toMatch(/try again/i);
    expect(friendlyError({ weird: true })).toMatch(/try again/i);
  });
});
