/**
 * The sign-in form showed "Firebase: Error (auth/invalid-credential)." verbatim,
 * and a failed status change on the board showed nothing at all.
 */

import { describe, expect, it } from "vitest";

import {
  friendlyLoadError,
  friendlySignInError,
  friendlyStatusError,
} from "@/lib/friendly-errors";

/** Shaped like the SDK's FirebaseError: a code, and developer text. */
function firebaseError(code: string): Error {
  return Object.assign(new Error(`Firebase: Error (${code}).`), { code });
}

describe("friendlySignInError", () => {
  it.each([
    ["auth/invalid-credential", /email and password don't match/],
    ["auth/wrong-password", /email and password don't match/],
    ["auth/user-not-found", /email and password don't match/],
    ["auth/too-many-requests", /Too many tries/],
    ["auth/network-request-failed", /Check the wifi/],
    ["auth/user-disabled", /switched off/],
    ["auth/operation-not-allowed", /isn't switched on/],
  ])("%s", (code, message) => {
    const text = friendlySignInError(firebaseError(code));
    expect(text).toMatch(message);
    expect(text).not.toMatch(/Firebase: Error|auth\//);
  });

  it("reads the code out of the message when there is no code property", () => {
    expect(
      friendlySignInError(
        new Error("Firebase: Error (auth/invalid-credential)."),
      ),
    ).toBe("That email and password don't match.");
  });

  it("never shows Firebase's own text for an unknown code", () => {
    expect(friendlySignInError(firebaseError("auth/something-new"))).toBe(
      "Sign-in didn't work. Try again.",
    );
    expect(friendlySignInError("not even an error")).toBe(
      "Sign-in didn't work. Try again.",
    );
  });

  it("keeps a message that was already written for people (demo mode)", () => {
    expect(
      friendlySignInError(
        new Error("Wrong PIN. Ask the counter for today's code."),
      ),
    ).toBe("Wrong PIN. Ask the counter for today's code.");
  });
});

describe("friendlyStatusError", () => {
  it("explains a refused write", () => {
    expect(
      friendlyStatusError(
        Object.assign(new Error("Missing or insufficient permissions."), {
          code: "permission-denied",
        }),
      ),
    ).toMatch(/refused that change/);
  });

  it("explains a dropped connection", () => {
    expect(
      friendlyStatusError(
        Object.assign(new Error("x"), { code: "unavailable" }),
      ),
    ).toMatch(/connection dropped/);
  });

  it("falls back to something plain", () => {
    expect(friendlyStatusError(new Error("FirebaseError: weird"))).toBe(
      "Couldn't update that order. Try again.",
    );
  });
});

describe("friendlyLoadError", () => {
  it("explains a refused read without Firebase jargon", () => {
    expect(
      friendlyLoadError(
        Object.assign(new Error("Missing or insufficient permissions."), {
          code: "permission-denied",
        }),
      ),
    ).toMatch(/isn't allowed to read past orders/);
    expect(friendlyLoadError(new Error("FirebaseError: boom"))).toBe(
      "Couldn't load orders. Try again.",
    );
  });
});
