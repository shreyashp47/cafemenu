/**
 * Error types the CLI maps to exit codes (see bin/deployer.mjs):
 *
 *   UsageError         2  the command line is wrong; nothing was called
 *   ActionNeededError  3  a person has to do something first (grant a role,
 *                         click a console button, pick another site name);
 *                         re-run afterwards
 *   anything else      1  a call failed; re-running is safe
 */

export class UsageError extends Error {
  name = "UsageError";
}

export class ActionNeededError extends Error {
  name = "ActionNeededError";

  /** `hint` is the "what to do now" line printed under the message. */
  constructor(message, { hint, details } = {}) {
    super(message);
    this.hint = hint;
    this.details = details;
  }
}

/** A site name is already used by another Firebase project. */
export class SiteNameTakenError extends ActionNeededError {
  name = "SiteNameTakenError";

  constructor(site, suggestions = []) {
    super(
      `The Hosting site name "${site}" is taken by another Firebase project.`,
      {
        hint: suggestions.length
          ? `Free right now: ${suggestions.join(", ")}. Re-run with --site <one of them>.`
          : "Pick another name and re-run with --site <name>.",
      },
    );
    this.site = site;
    this.suggestions = suggestions;
  }
}

/**
 * A Google API answered with an error. `status` is the HTTP status, `code` the
 * canonical error code when Google sends one (ALREADY_EXISTS, NOT_FOUND, ...),
 * and `reason` the bare message, which for Identity Toolkit v1 is itself the
 * code (EMAIL_EXISTS, CONFIGURATION_NOT_FOUND, ...).
 */
export class ApiError extends Error {
  name = "ApiError";

  constructor({ method, url, status, code, reason }) {
    super(
      `${method} ${url} failed (${status}${code ? ` ${code}` : ""}): ${reason}`,
    );
    this.method = method;
    this.url = url;
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

/** A long-running operation finished with an error. */
export class OperationError extends Error {
  name = "OperationError";

  constructor(what, error = {}) {
    super(
      `${what} failed${error.code ? ` (code ${error.code})` : ""}: ${error.message ?? "no message"}`,
    );
    this.error = error;
  }
}

/**
 * A command tried to write during a dry run. This is a bug in the deployer,
 * not in the project: commands must check `dryRun` before writing, and the
 * HTTP client refuses as a second line of defence.
 */
export class DryRunWriteError extends Error {
  name = "DryRunWriteError";

  constructor(method, url) {
    super(`Refused ${method} ${url}: it writes, and this is a dry run.`);
  }
}
