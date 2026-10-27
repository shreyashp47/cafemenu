/**
 * What the callables refuse with. `code` is a Firebase Functions error code
 * ("permission-denied", "failed-precondition", ...), which index.mjs turns
 * into an HttpsError and the console's client turns back into a CodedError
 * with the same words (apps/console/src/lib/data/types.ts).
 */
export class RequestError extends Error {
  name = "RequestError";

  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * A run that can't go on now but can later: out of time, or Google didn't
 * answer. The worker puts the deployment back in the queue and rethrows, so
 * Cloud Functions' event retry runs it again from the step it stopped at.
 */
export class RetryLater extends Error {
  name = "RetryLater";
}

/** The deploy account lacks permissions `check` tests for (provisioning's first step). */
export class MissingAccessError extends Error {
  name = "MissingAccessError";

  /** `missing` is `check`'s {command: [{permission, why}]}. */
  constructor(missing) {
    super("The deploy account is missing permissions in the project.");
    this.missing = missing;
  }
}

/**
 * A request that can't be done yet: a suspension with a notice period waits
 * for its date. The worker puts it back in the queue with `notBefore`, and
 * leaves it there, unclaimed, until then.
 */
export class Deferred extends Error {
  name = "Deferred";

  /** `until` in ms; `message` says, in words for the page, what it waits for. */
  constructor(until, message) {
    super(message);
    this.until = until;
  }
}
