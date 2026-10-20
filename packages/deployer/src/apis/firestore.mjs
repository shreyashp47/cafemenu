/**
 * Firestore: the Admin API (the database itself and its composite indexes)
 * and the documents API (one document at a time, as the project's admin, so
 * firestore.rules don't apply).
 */
import { withQuery } from "../http.mjs";

export const FIRESTORE = "https://firestore.googleapis.com/v1";
export const DEFAULT_DATABASE = "(default)";

const databaseName = (project) =>
  `projects/${project}/databases/${DEFAULT_DATABASE}`;

/** The (default) database, or null if the project has none yet. */
export async function getDatabase(api, project) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/get
  // GET v1/projects/{id}/databases/(default) → Database {name, locationId, type, …}
  // UNVERIFIED: run in spike #4
  return api.get(`${FIRESTORE}/${databaseName(project)}`, { notFound: null });
}

/** Creates the (default) database in Native mode and waits for it. */
export async function createDatabase(api, project, locationId) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/create
  // POST v1/projects/{id}/databases?databaseId=(default) {locationId, type} → Operation
  // UNVERIFIED: run in spike #4 (not yet known to work on Spark with no billing account)
  const op = await api.post(
    withQuery(`${FIRESTORE}/projects/${project}/databases`, {
      databaseId: DEFAULT_DATABASE,
    }),
    { locationId, type: "FIRESTORE_NATIVE" },
  );
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.operations/get
  // UNVERIFIED: run in spike #4
  return api.waitForOperation(FIRESTORE, op, {
    what: "Creating the Firestore database",
    timeoutMs: 10 * 60_000,
  });
}

/** Every composite index in the (default) database, across collection groups. */
export async function listIndexes(api, project) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes/list
  // GET v1/{database}/collectionGroups/-/indexes → {indexes, nextPageToken}
  // "-" stands for every collection group, as firebase-tools uses it.
  // UNVERIFIED: run in spike #5
  return api.list(
    `${FIRESTORE}/${databaseName(project)}/collectionGroups/-/indexes`,
    "indexes",
  );
}

/**
 * Starts building one composite index. Returns the Operation without waiting:
 * a build takes minutes, and queries that need it fail with
 * FAILED_PRECONDITION until it is READY.
 */
export async function createIndex(api, project, collectionGroup, index) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes/create
  // POST v1/{database}/collectionGroups/{group}/indexes Index {queryScope, fields} → Operation
  // UNVERIFIED: run in spike #5
  return api.post(
    `${FIRESTORE}/${databaseName(project)}/collectionGroups/${encodeURIComponent(collectionGroup)}/indexes`,
    index,
  );
}

const documentUrl = (project, path) =>
  `${FIRESTORE}/${databaseName(project)}/documents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

/** The document ({name, fields}), or null if it doesn't exist. */
export async function getDocument(api, project, path) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/get
  // GET v1/{database}/documents/{path} → Document {name, fields}
  // UNVERIFIED: run in spike #6
  return api.get(documentUrl(project, path), { notFound: null });
}

/**
 * Creates the document or updates only the fields in `fieldPaths`, leaving
 * any others alone (what TOE's seed-staff does).
 */
export async function patchDocument(api, project, path, fields, fieldPaths) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/patch
  // PATCH v1/{database}/documents/{path}?updateMask.fieldPaths=… Document {fields} → Document
  // UNVERIFIED: run in spike #6
  return api.patch(
    withQuery(documentUrl(project, path), {
      "updateMask.fieldPaths": fieldPaths,
    }),
    { fields },
  );
}

// --- Firestore value encoding (only the types the deployer writes) ---------

export function encodeFields(object) {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => {
      if (typeof value === "string") return [key, { stringValue: value }];
      if (typeof value === "boolean") return [key, { booleanValue: value }];
      if (Number.isInteger(value))
        return [key, { integerValue: String(value) }];
      throw new Error(`Can't encode ${key}: ${typeof value}`);
    }),
  );
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if ("stringValue" in value) return [key, value.stringValue];
      if ("booleanValue" in value) return [key, value.booleanValue];
      if ("integerValue" in value) return [key, Number(value.integerValue)];
      if ("doubleValue" in value) return [key, value.doubleValue];
      if ("nullValue" in value) return [key, null];
      return [key, undefined];
    }),
  );
}
