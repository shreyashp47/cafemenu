/**
 * What went wrong, in words a cafe owner can act on. The deployer's own
 * messages are for someone at a terminal ("re-run with --site"), so the
 * failures an owner can meet are rewritten here; anything else gets the
 * honest "something unexpected" with a reference the maintainer can find in
 * the logs. The result is `{code, message, hint, draft}`:
 *
 *   code     a short name for the kind of failure, for the screen and tests
 *   message  what happened
 *   hint     what to do next
 *   draft    the cafe goes back to `draft` so the owner can change its
 *            settings (the rules only let them while it is a draft)
 */
import {
  ActionNeededError,
  ApiError,
  SiteNameTakenError,
  UsageError,
} from "@cafemenu/deployer";

import { MissingAccessError } from "./errors.mjs";
import { isTransient } from "./retry.mjs";

const AUTH_NOT_STARTED = /Authentication isn't set up/i;

const list = (items) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const consoleUrl = (project, page) =>
  `https://console.firebase.google.com/project/${project}/${page}`;

/** The ActionNeededErrors a multi-part provision error carries, or itself. */
const parts = (error) =>
  error instanceof ActionNeededError && Array.isArray(error.details)
    ? error.details
    : [error];

export function explain(
  error,
  { project, clientEmail, step, deploymentId } = {},
) {
  const account = clientEmail ?? "CafeMenu's deploy account";
  const where = project ?? "your project";

  if (error instanceof MissingAccessError) {
    const wants = Object.values(error.missing)
      .flat()
      .map((m) => m.why);
    return {
      code: "missing-permissions",
      message: `CafeMenu's deploy account can see ${where}, but it isn't allowed to ${list([...new Set(wants)])}.`,
      hint: `In your project's IAM page, give ${account} a role that includes these permissions, then press Try again. [[SPIKE #3: the exact role]]`,
    };
  }

  if (error instanceof SiteNameTakenError) {
    return {
      code: "site-name-taken",
      draft: true,
      message: `The web address ${error.site}.web.app is already used by someone else.`,
      hint: error.suggestions.length
        ? `Free right now: ${list(error.suggestions.map((s) => `${s}.web.app`))}. Choose another web address, then try again.`
        : "Choose another web address, then try again.",
    };
  }

  if (error instanceof ActionNeededError) {
    const all = parts(error);
    if (all.length > 1) {
      // Several things need doing: every one of them, in one message.
      const each = all.map((e) => explain(e, { project, clientEmail, step }));
      return {
        code: "several",
        draft: each.some((e) => e.draft),
        message: each.map((e) => e.message).join(" "),
        hint: [...new Set(each.map((e) => e.hint))].join(" "),
      };
    }
    if (all[0] !== error)
      return explain(all[0], { project, clientEmail, step });
    if (AUTH_NOT_STARTED.test(error.message)) {
      return {
        code: "auth-not-started",
        message: "Sign-in isn't switched on in your Firebase project yet.",
        hint: `Google only lets you do this one yourself: open ${consoleUrl(where, "authentication")}, press Get started, then press Try again here.`,
      };
    }
    if (
      /has no access to project|isn't a Firebase project/i.test(error.message)
    ) {
      return noAccess(account, where);
    }
    return {
      code: "needs-attention",
      message: error.message,
      hint: `${error.hint ?? ""} Then press Try again; if it isn't something you can sort out, tell the CafeMenu maintainer.`.trim(),
    };
  }

  if (error?.name === "SmokeTestError") {
    return {
      code: "smoke-test-failed",
      message: error.message,
      hint: error.rolledBackTo
        ? "Your cafe is running as it was, so nothing is needed from you. The maintainer can see what failed."
        : "Press Try again. If it fails again, tell the CafeMenu maintainer.",
    };
  }

  if (error instanceof UsageError) {
    return {
      code: "invalid-details",
      message: `Your cafe's saved details can't be used as they are. ${error.message}`,
      hint: "Fix them in the cafe's settings, then try again.",
    };
  }

  if (
    error instanceof ApiError &&
    error.status === 403 &&
    !isTransient(error)
  ) {
    return noAccess(account, where);
  }

  if (isTransient(error)) {
    return {
      code: "google-slow",
      message: "Google didn't answer properly, even after several tries.",
      hint: "Nothing is broken, and setup carries on from where it stopped. Press Try again in a few minutes.",
    };
  }

  return {
    code: "unexpected",
    message: `Something unexpected went wrong${step ? ` while doing "${step}"` : ""}.`,
    hint: `Your cafe is safe, and setup carries on from where it stopped. Press Try again. If it fails again, tell the CafeMenu maintainer${deploymentId ? ` (reference ${deploymentId})` : ""}.`,
  };
}

function noAccess(account, where) {
  return {
    code: "no-access",
    message: `CafeMenu's deploy account can't get into ${where} (it may have been removed, or the project ID may be wrong).`,
    hint: `Open ${consoleUrl(where, "settings/iam")}, add ${account} as a member again, then press Try again.`,
  };
}

/** The one string kept on the deployment: the console shows `error` as it is. */
export const errorText = ({ message, hint }) => `${message} ${hint}`.trim();
