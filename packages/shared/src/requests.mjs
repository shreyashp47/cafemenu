/**
 * Requests to CafeMenu's backend (#77, and the admin's, #78): what the console writes to
 * `requests/{id}` in the platform's Firestore, and what the backend answers
 * on the same document. One contract for the three sides, so they agree:
 *
 *   the console     writes a request with newRequestRecord(), then listens to it
 *   the rules       apps/console/firestore.rules, `match /requests/{id}`, allow
 *                   exactly that record, for the caller's own cafe
 *   the backend     apps/platform-functions/src/worker/: picks queued ones up,
 *                   claims each in a transaction, does the work, and writes
 *                   `status`, `progress`, `result` and `error` back
 *
 * Plain JavaScript with types in requests.d.mts, like support-window.mjs, so
 * the backend imports it on Node without a build step.
 *
 * A request is written once by a person and then only by the backend:
 *
 *   cafeId     the cafe it is about
 *   kind       what is asked (REQUEST_KINDS)
 *   params     what the kind needs (see requestParamsProblem): {} for most
 *   status     "queued" when written; the backend moves it on
 *   createdAt  the server's time (serverTimestamp())
 *   by         the uid of who asked
 *
 * The backend adds `progress` ({steps, detail}), `result`, `error` and
 * `errorCode`, `deploymentId` when the request became a deployment, and its
 * own bookkeeping (`attempts`, `lease`, `startedAt`, `finishedAt`).
 */

import {
  MAINTENANCE_REASONS,
  REACTIVATION_REASONS,
  REASON_NOTE_MAX,
  SUSPENSION_REASONS,
} from "./admin-policy.mjs";
import { MAINTENANCE_MESSAGE_MAX } from "./maintenance.mjs";

/**
 * What an owner (or the admin, for any cafe) may ask:
 *
 *   provision      set the cafe's Firebase project up and put CafeMenu on it
 *   check          "Check connection": may the deploy account do its work?
 *   deploy         upgrade to `params.version`
 *   rollback       back to the version before
 *   sync-branding  put the cafe's saved settings and logo on its site
 */
export const OWNER_REQUEST_KINDS = Object.freeze([
  "provision",
  "check",
  "deploy",
  "rollback",
  "sync-branding",
]);

/**
 * What only the admin may ask (#78, docs/super-admin-requirements.md). Each
 * carries a reason (admin-policy.mjs) and is written to the admin log:
 *
 *   suspend          suspend the cafe's owner: their login, their requests,
 *                    their rollouts; `effectiveAt` for a notice period
 *   reactivate       undo a suspension
 *   delete-owner     remove the owner's login and every record of them but
 *                    the admin log; `confirm` is the cafe's web address
 *   maintenance-on   take the cafe's site into maintenance (the admin's)
 *   maintenance-off  end the admin's maintenance
 *   appoint-admin    make the account with `email` an admin (no cafe)
 *   remove-admin     stop it being one (no cafe)
 */
export const ADMIN_REQUEST_KINDS = Object.freeze([
  "suspend",
  "reactivate",
  "delete-owner",
  "maintenance-on",
  "maintenance-off",
  "appoint-admin",
  "remove-admin",
]);

/** The admin kinds about an account rather than a cafe: `cafeId` is null. */
export const CAFELESS_REQUEST_KINDS = Object.freeze([
  "appoint-admin",
  "remove-admin",
]);

export const REQUEST_KINDS = Object.freeze([
  ...OWNER_REQUEST_KINDS,
  ...ADMIN_REQUEST_KINDS,
]);

/** The kinds that become a `deployments/{id}` the backend then runs. */
export const DEPLOYMENT_REQUEST_KINDS = Object.freeze([
  "provision",
  "deploy",
  "rollback",
  "sync-branding",
]);

/**
 *   queued   written, waiting for the backend's next run
 *   running  the backend has claimed it and is working on it
 *   done     finished: `result` says what came of it
 *   failed   refused or went wrong: `error` says why, in words for the owner
 */
export const REQUEST_STATUSES = Object.freeze([
  "queued",
  "running",
  "done",
  "failed",
]);

export const OPEN_REQUEST_STATUSES = Object.freeze(["queued", "running"]);
export const FINISHED_REQUEST_STATUSES = Object.freeze(["done", "failed"]);

/** A cafe's document id: what the rules accept before they look the cafe up. */
export const CAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A Google Cloud project ID, as firestore.rules' isProjectId. */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
/** A release version: "1.4.2", "1.5.0-beta.1". */
export const RELEASE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]{1,40})?$/;

const isPlainObject = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const exactly = (params, keys) => {
  const own = Object.keys(params);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A batch of bulk maintenance requests made together. */
const BATCH = /^[A-Za-z0-9_-]{1,64}$/;

const isText = (value, max) => typeof value === "string" && value.length <= max;
/** A time as the console sends it (a Date) or Firestore hands it back. */
const isTimeOrNull = (value) =>
  value === null ||
  (value instanceof Date && Number.isFinite(value.getTime())) ||
  typeof value?.toMillis === "function";

/** An admin request's reason and note, from `reasons`. */
const reasonProblem = (params, reasons) =>
  !reasons.includes(params.reason)
    ? "reason"
    : !isText(params.note, REASON_NOTE_MAX)
      ? "note"
      : null;

const ADMIN_PARAMS = {
  suspend: (p) =>
    !exactly(p, ["reason", "note", "effectiveAt"])
      ? "params"
      : (reasonProblem(p, SUSPENSION_REASONS) ??
        (isTimeOrNull(p.effectiveAt) ? null : "time")),
  reactivate: (p) =>
    !exactly(p, ["reason", "note"])
      ? "params"
      : reasonProblem(p, REACTIVATION_REASONS),
  "delete-owner": (p) =>
    !exactly(p, ["reason", "note", "confirm"])
      ? "params"
      : (reasonProblem(p, SUSPENSION_REASONS) ??
        (isText(p.confirm, 64) && p.confirm !== "" ? null : "confirm")),
  "maintenance-on": (p) =>
    !exactly(p, [
      "reason",
      "note",
      "message",
      "until",
      "startsAt",
      "endsAt",
      "batch",
    ])
      ? "params"
      : (reasonProblem(p, MAINTENANCE_REASONS) ??
        (!isText(p.message, MAINTENANCE_MESSAGE_MAX)
          ? "message"
          : ![p.until, p.startsAt, p.endsAt].every(isTimeOrNull)
            ? "time"
            : p.batch === null || BATCH.test(p.batch)
              ? null
              : "batch")),
  "maintenance-off": (p) =>
    !exactly(p, ["note", "batch"])
      ? "params"
      : !isText(p.note, REASON_NOTE_MAX)
        ? "note"
        : p.batch === null || BATCH.test(p.batch)
          ? null
          : "batch",
  "appoint-admin": (p) =>
    !exactly(p, ["email", "note"])
      ? "params"
      : typeof p.email === "string" &&
          p.email.length <= 254 &&
          EMAIL.test(p.email)
        ? isText(p.note, REASON_NOTE_MAX)
          ? null
          : "note"
        : "email",
};
ADMIN_PARAMS["remove-admin"] = ADMIN_PARAMS["appoint-admin"];

/**
 * What is wrong with a request's kind and params, or null when nothing is:
 *
 *   kind        not one of REQUEST_KINDS
 *   params      not a map, or not exactly the keys the kind takes
 *   project-id  check: `projectId` is not a project ID
 *   version     deploy: `version` is not a release version
 *   reason      an admin kind: not one of the policy's reasons for it
 *   note        an admin kind: the free text is too long, or not text
 *   time        a time that is neither a Date nor a Timestamp, nor null
 *   message     maintenance-on: the customers' message is too long
 *   batch       maintenance: the batch id isn't one
 *   confirm     delete-owner: the typed web address is missing
 *   email       appoint-admin, remove-admin: not an email address
 */
export function requestParamsProblem(kind, params) {
  if (!REQUEST_KINDS.includes(kind)) return "kind";
  if (!isPlainObject(params)) return "params";
  if (Object.hasOwn(ADMIN_PARAMS, kind)) return ADMIN_PARAMS[kind](params);
  switch (kind) {
    case "check":
      if (!exactly(params, ["projectId"])) return "params";
      return typeof params.projectId === "string" &&
        PROJECT_ID.test(params.projectId)
        ? null
        : "project-id";
    case "deploy":
      if (!exactly(params, ["version"])) return "params";
      return typeof params.version === "string" &&
        RELEASE_VERSION.test(params.version)
        ? null
        : "version";
    default:
      return exactly(params, []) ? null : "params";
  }
}

/**
 * The record a person writes, exactly as the rules allow it. `createdAt` is
 * serverTimestamp() for Firestore (the rules want the server's time), or a
 * number in tests and demo stores. Throws when the kind or params are wrong,
 * so a mistake shows up here rather than as "permission-denied".
 */
export function newRequestRecord({ cafeId, kind, params = {}, by }, createdAt) {
  const cafeless = CAFELESS_REQUEST_KINDS.includes(kind);
  if (
    cafeless
      ? cafeId !== null
      : typeof cafeId !== "string" || !CAFE_ID.test(cafeId)
  ) {
    throw new TypeError(
      cafeless
        ? "This request is about an account, not a cafe."
        : "A request needs the id of the cafe it is about.",
    );
  }
  if (typeof by !== "string" || by === "") {
    throw new TypeError("A request needs who asked.");
  }
  const problem = requestParamsProblem(kind, params);
  if (problem) {
    throw new TypeError(`This request can't be made (${problem}).`);
  }
  return {
    cafeId,
    kind,
    params: { ...params },
    status: "queued",
    createdAt,
    by,
  };
}

export const isOpenRequest = (status) => OPEN_REQUEST_STATUSES.includes(status);

export const isAdminRequestKind = (kind) => ADMIN_REQUEST_KINDS.includes(kind);
