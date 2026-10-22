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

/** One JSON-like value as a Firestore Value. */
export function encodeValue(value, key = "value") {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number" && Number.isFinite(value))
    return { doubleValue: value };
  if (Array.isArray(value)) {
    return {
      arrayValue: value.length
        ? { values: value.map((item) => encodeValue(item, key)) }
        : {},
    };
  }
  if (typeof value === "object")
    return { mapValue: { fields: encodeFields(value) } };
  throw new Error(`Can't encode ${key}: ${typeof value}`);
}

export function encodeFields(object) {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [
      key,
      encodeValue(value, key),
    ]),
  );
}

/** A Firestore Value as JSON-like data; types the deployer never writes are undefined. */
export function decodeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value)
    return (value.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields);
  return undefined;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}
