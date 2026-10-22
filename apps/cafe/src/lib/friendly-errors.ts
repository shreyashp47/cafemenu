/**
 * Turning Firebase's errors into something a barista can act on.
 *
 * The raw text is written for developers — "Firebase: Error
 * (auth/invalid-credential)." — and it was being shown verbatim on the sign-in
 * form. The order-board write had it worse: a failed status change showed
 * nothing at all. Same approach as place-order's messages: map the codes that
 * actually happen, and keep anything already written for people.
 */

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

const SIGN_IN: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match.",
  "auth/wrong-password": "That email and password don't match.",
  "auth/user-not-found": "That email and password don't match.",
  "auth/invalid-login-credentials": "That email and password don't match.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/missing-password": "Enter your password.",
  "auth/too-many-requests":
    "Too many tries. Wait a minute, then try again — or ask the owner to reset your password.",
  "auth/network-request-failed":
    "Can't reach the sign-in server. Check the wifi and try again.",
  "auth/user-disabled": "This account has been switched off. Ask the owner.",
  "auth/operation-not-allowed":
    "Email sign-in isn't switched on for this cafe yet. The owner needs to enable it in the Firebase console.",
  // Signing up on /join.
  "auth/weak-password": "Pick a longer password: at least 6 characters.",
  "auth/email-already-in-use":
    "That email already has an account. Enter its password to sign in.",
};

export function friendlySignInError(error: unknown): string {
  const code = codeOf(error);
  if (code && SIGN_IN[code]) return SIGN_IN[code];
  return humanOrNull(error) ?? "Sign-in didn't work. Try again.";
}

const WRITE: Record<string, string> = {
  "permission-denied":
    "The database refused that change. The order may have already moved on — the board will catch up in a moment.",
  unavailable: "Couldn't save — the connection dropped. Try again.",
  "deadline-exceeded": "Couldn't save — the connection is slow. Try again.",
  "not-found": "That order no longer exists.",
  unauthenticated: "You've been signed out. Sign in again to update orders.",
};

export function friendlyStatusError(error: unknown): string {
  const code = codeOf(error);
  if (code && WRITE[code]) return WRITE[code];
  return humanOrNull(error) ?? "Couldn't update that order. Try again.";
}

const READ: Record<string, string> = {
  "permission-denied":
    "This account isn't allowed to read past orders. Sign in with the owner account, or check that it has a staff record.",
  unauthenticated: "You've been signed out. Sign in again to see past orders.",
  unavailable: "Can't reach the database — the connection dropped. Try again.",
  "deadline-exceeded":
    "The database took too long to answer. Try again, or pick a shorter range.",
  "resource-exhausted":
    "Today's free database allowance is used up. History will load again tomorrow.",
};

/** Loading a list of orders (the owner's history). */
export function friendlyLoadError(error: unknown): string {
  const code = codeOf(error);
  if (code && READ[code]) return READ[code];
  return humanOrNull(error) ?? "Couldn't load orders. Try again.";
}

const TEAM: Record<string, string> = {
  "permission-denied":
    "The database refused that change. Only an owner can manage the team.",
  "not-found": "That person or invite is already gone.",
  unauthenticated: "You've been signed out. Sign in again.",
  unavailable: "Couldn't save — the connection dropped. Try again.",
  "deadline-exceeded": "Couldn't save — the connection is slow. Try again.",
};

/** The owner's staff page: invites, roles, removals. */
export function friendlyTeamError(error: unknown): string {
  const code = codeOf(error);
  if (code && TEAM[code]) return TEAM[code];
  return humanOrNull(error) ?? "That didn't work. Try again.";
}

/**
 * Joining with an invite on /join: the sign-up's errors, and the rules
 * refusing the invite itself, which is all the reasons it can be refused.
 */
export function friendlyJoinError(error: unknown): string {
  const code = codeOf(error);
  if (code && SIGN_IN[code]) return SIGN_IN[code];
  if (code === "permission-denied") {
    return "This invite doesn't work any more: it was used, cancelled or has expired. Ask the owner for a new link.";
  }
  if (code && TEAM[code]) return TEAM[code];
  return humanOrNull(error) ?? "Joining didn't work. Try again.";
}
