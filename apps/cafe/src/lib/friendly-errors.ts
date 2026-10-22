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
  "auth/invalid-credential": "errors.signInMismatch",
  "auth/wrong-password": "errors.signInMismatch",
  "auth/user-not-found": "errors.signInMismatch",
  "auth/invalid-login-credentials": "errors.signInMismatch",
  "auth/invalid-email": "errors.invalidEmail",
  "auth/missing-password": "errors.missingPassword",
  "auth/too-many-requests": "errors.tooManyTries",
  "auth/network-request-failed": "errors.signInNetwork",
  "auth/user-disabled": "errors.userDisabled",
  "auth/operation-not-allowed": "errors.emailSignInOff",
  // Signing up on /join.
  "auth/weak-password": "errors.weakPassword",
  "auth/email-already-in-use": "errors.emailInUse",
};

export function friendlySignInError(error: unknown): string {
  const code = codeOf(error);
  if (code && SIGN_IN[code]) return t(SIGN_IN[code]);
  return humanOrNull(error) ?? t("errors.signInFailed");
}

const WRITE: Record<string, MessageKey> = {
  "permission-denied": "errors.writeDenied",
  unavailable: "errors.saveDropped",
  "deadline-exceeded": "errors.saveSlow",
  "not-found": "errors.orderGone",
  unauthenticated: "errors.signedOutUpdate",
};

export function friendlyStatusError(error: unknown): string {
  const code = codeOf(error);
  if (code && WRITE[code]) return t(WRITE[code]);
  return humanOrNull(error) ?? t("errors.updateFailed");
}

const READ: Record<string, MessageKey> = {
  "permission-denied": "errors.readDenied",
  unauthenticated: "errors.signedOutHistory",
  unavailable: "errors.readDropped",
  "deadline-exceeded": "errors.readSlow",
  "resource-exhausted": "errors.quotaUsed",
};

/** Loading a list of orders (the owner's history). */
export function friendlyLoadError(error: unknown): string {
  const code = codeOf(error);
  if (code && READ[code]) return t(READ[code]);
  return humanOrNull(error) ?? t("errors.loadFailed");
}

const TEAM: Record<string, MessageKey> = {
  "permission-denied": "errors.teamDenied",
  "not-found": "errors.teamGone",
  unauthenticated: "errors.signedOut",
  unavailable: "errors.saveDropped",
  "deadline-exceeded": "errors.saveSlow",
};

/** The owner's staff page: invites, roles, removals. */
export function friendlyTeamError(error: unknown): string {
  const code = codeOf(error);
  if (code && TEAM[code]) return t(TEAM[code]);
  return humanOrNull(error) ?? t("errors.teamFailed");
}

/**
 * Joining with an invite on /join: the sign-up's errors, and the rules
 * refusing the invite itself, which is all the reasons it can be refused.
 */
export function friendlyJoinError(error: unknown): string {
  const code = codeOf(error);
  if (code && SIGN_IN[code]) return t(SIGN_IN[code]);
  if (code === "permission-denied") return t("errors.inviteRefused");
  if (code && TEAM[code]) return t(TEAM[code]);
  return humanOrNull(error) ?? t("errors.joinFailed");
}
