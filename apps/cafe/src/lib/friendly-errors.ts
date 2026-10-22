/**
 * Turning Firebase's errors into something a barista can act on.
 *
 * The raw text is written for developers — "Firebase: Error
 * (auth/invalid-credential)." — and it was being shown verbatim on the sign-in
 * form. The order-board write had it worse: a failed status change showed
 * nothing at all. Same approach as place-order's messages: map the codes that
 * actually happen, and keep anything already written for people.
 */

import { t, type MessageKey } from "./i18n";

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    const match = /\(([a-z-]+\/[a-z0-9-]+)\)/.exec(message);
    if (match) return match[1];
  }
  return null;
}

function rawMessage(error: unknown): string | null {
  return error instanceof Error && error.message ? error.message : null;
}

/** A message is "for people" unless it is Firebase's own developer text. */
function humanOrNull(error: unknown): string | null {
  const message = rawMessage(error);
  if (!message || /firebase|\(auth\/|\bfirestore\b/i.test(message)) return null;
  return message;
}

const SIGN_IN: Record<string, MessageKey> = {
  "auth/invalid-credential": "friendlyErrors.signInMismatch",
  "auth/wrong-password": "friendlyErrors.signInMismatch",
  "auth/user-not-found": "friendlyErrors.signInMismatch",
  "auth/invalid-login-credentials": "friendlyErrors.signInMismatch",
  "auth/invalid-email": "friendlyErrors.invalidEmail",
  "auth/missing-password": "friendlyErrors.missingPassword",
  "auth/too-many-requests": "friendlyErrors.tooManyTries",
  "auth/network-request-failed": "friendlyErrors.signInNetwork",
  "auth/user-disabled": "friendlyErrors.userDisabled",
  "auth/operation-not-allowed": "friendlyErrors.emailSignInOff",
  // Signing up on /join.
  "auth/weak-password": "friendlyErrors.weakPassword",
  "auth/email-already-in-use": "friendlyErrors.emailInUse",
};

export function friendlySignInError(error: unknown): string {
  const code = codeOf(error);
  if (code && SIGN_IN[code]) return t(SIGN_IN[code]);
  return humanOrNull(error) ?? t("friendlyErrors.signInFailed");
}

const WRITE: Record<string, MessageKey> = {
  "permission-denied": "friendlyErrors.writeDenied",
  unavailable: "friendlyErrors.saveDropped",
  "deadline-exceeded": "friendlyErrors.saveSlow",
  "not-found": "friendlyErrors.orderGone",
  unauthenticated: "friendlyErrors.signedOutUpdate",
};

export function friendlyStatusError(error: unknown): string {
  const code = codeOf(error);
  if (code && WRITE[code]) return t(WRITE[code]);
  return humanOrNull(error) ?? t("friendlyErrors.updateFailed");
}

const READ: Record<string, MessageKey> = {
  "permission-denied": "friendlyErrors.readDenied",
  unauthenticated: "friendlyErrors.signedOutHistory",
  unavailable: "friendlyErrors.readDropped",
  "deadline-exceeded": "friendlyErrors.readSlow",
  "resource-exhausted": "friendlyErrors.quotaUsed",
};

/** Loading a list of orders (the owner's history). */
export function friendlyLoadError(error: unknown): string {
  const code = codeOf(error);
  if (code && READ[code]) return t(READ[code]);
  return humanOrNull(error) ?? t("friendlyErrors.loadFailed");
}

const TEAM: Record<string, MessageKey> = {
  "permission-denied": "friendlyErrors.teamDenied",
  "not-found": "friendlyErrors.teamGone",
  unauthenticated: "friendlyErrors.signedOut",
  unavailable: "friendlyErrors.saveDropped",
  "deadline-exceeded": "friendlyErrors.saveSlow",
};

/** The owner's staff page: invites, roles, removals. */
export function friendlyTeamError(error: unknown): string {
  const code = codeOf(error);
  if (code && TEAM[code]) return t(TEAM[code]);
  return humanOrNull(error) ?? t("friendlyErrors.teamFailed");
}

/**
 * Joining with an invite on /join: the sign-up's errors, and the rules
 * refusing the invite itself, which is all the reasons it can be refused.
 */
export function friendlyJoinError(error: unknown): string {
  const code = codeOf(error);
  if (code && SIGN_IN[code]) return t(SIGN_IN[code]);
  if (code === "permission-denied") return t("friendlyErrors.inviteRefused");
  if (code && TEAM[code]) return t(TEAM[code]);
  return humanOrNull(error) ?? t("friendlyErrors.joinFailed");
}
