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

/** A document's full resource name, as runQuery and commit take it. */
export const documentName = (project, path) =>
  `${databaseName(project)}/documents/${path}`;

/**
 * Up to `limit` documents of one top-level collection, in document-ID order,
 * after the document named `after` (a full name) if given. Each is
 * {name, fields, createTime, updateTime}.
 */
export async function queryCollection(
  api,
  project,
  collectionId,
  { after, limit },
) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery
  // POST v1/{database}/documents:runQuery {structuredQuery} → [{document?, readTime}]
  // Checked against the Firestore emulator (tests/emulator/); UNVERIFIED on
  // the real API: run in spike #6
  const res = await api.post(
    `${FIRESTORE}/${databaseName(project)}/documents:runQuery`,
    {
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        ...(after && {
          startAt: { values: [{ referenceValue: after }], before: false },
        }),
        limit,
      },
    },
    { write: false },
  );
  return (Array.isArray(res) ? res : [])
    .map((entry) => entry.document)
    .filter(Boolean);
}

/**
 * Applies `writes` atomically: all of them or, if any precondition fails,
 * none. Each write is {update: {name, fields}, updateMask: {fieldPaths},
 * currentDocument?: {updateTime} | {exists}}. Returns {writeResults,
 * commitTime}, one result (with the document's new updateTime) per write.
 */
export async function commit(api, project, writes) {
  // https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit
  // POST v1/{database}/documents:commit {writes} → {writeResults, commitTime}
  // At most 500 writes per commit.
  // Checked against the Firestore emulator (tests/emulator/); UNVERIFIED on
  // the real API: run in spike #6
  return api.post(`${FIRESTORE}/${databaseName(project)}/documents:commit`, {
    writes,
  });
}

// --- Firestore value encoding (only the types the deployer writes) ---------

/** One JSON-like value as a Firestore Value. */
export function encodeValue(value, key = "value") {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw new Error(`Can't encode ${key}: an invalid date`);
    return { timestampValue: value.toISOString() };
  }
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
  if ("timestampValue" in value) return new Date(value.timestampValue);
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
