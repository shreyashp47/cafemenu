/**
 * Requests to CafeMenu's backend (#77): what the console writes to
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

/**
 *   provision      set the cafe's Firebase project up and put CafeMenu on it
 *   check          "Check connection": may the deploy account do its work?
 *   deploy         upgrade to `params.version`
 *   rollback       back to the version before
 *   sync-branding  put the cafe's saved settings and logo on its site
 */
export const REQUEST_KINDS = Object.freeze([
  "provision",
  "check",
  "deploy",
  "rollback",
  "sync-branding",
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

/**
 * What is wrong with a request's kind and params, or null when nothing is:
 *
 *   kind        not one of REQUEST_KINDS
 *   params      not a map, or not exactly the keys the kind takes
 *   project-id  check: `projectId` is not a project ID
 *   version     deploy: `version` is not a release version
 */
export function requestParamsProblem(kind, params) {
  if (!REQUEST_KINDS.includes(kind)) return "kind";
  if (!isPlainObject(params)) return "params";
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
  if (typeof cafeId !== "string" || !CAFE_ID.test(cafeId)) {
    throw new TypeError("A request needs the id of the cafe it is about.");
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
