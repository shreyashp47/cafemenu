/**
 * Firebase Rules API. Deploying rules is two steps: upload the source as a
 * new (immutable) ruleset, then point the release Firestore reads,
 * `cloud.firestore`, at it.
 */

export const RULES = "https://firebaserules.googleapis.com/v1";
/** The release name Firestore's (default) database enforces. */
export const FIRESTORE_RELEASE = "cloud.firestore";

/** {name, rulesetName, createTime, updateTime}, or null if never released. */
export async function getRelease(api, project, releaseId) {
  // https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get
  // GET v1/projects/{id}/releases/{release} → Release
  // UNVERIFIED: run in spike #5
  return api.get(`${RULES}/projects/${project}/releases/${releaseId}`, {
    notFound: null,
  });
}

/**
 * {name, source: {files: [{name, content}]}, createTime}. Pass
 * `{notFound: null}` to get null for a ruleset that no longer exists.
 */
export async function getRuleset(api, rulesetName, options) {
  // https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get
  // GET v1/projects/{id}/rulesets/{ruleset} → Ruleset
  // UNVERIFIED: run in spike #5
  return api.get(`${RULES}/${rulesetName}`, options);
}

/** Compiles and stores `files`. A syntax error comes back as a 400 naming the line. */
export async function createRuleset(api, project, files) {
  // https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/create
  // POST v1/projects/{id}/rulesets Ruleset {source: {files: [{name, content}]}} → Ruleset {name}
  // UNVERIFIED: run in spike #5
  return api.post(`${RULES}/projects/${project}/rulesets`, {
    source: { files },
  });
}

export async function createRelease(api, project, releaseId, rulesetName) {
  // https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/create
  // POST v1/projects/{id}/releases Release {name, rulesetName} → Release
  // UNVERIFIED: run in spike #5
  return api.post(`${RULES}/projects/${project}/releases`, {
    name: `projects/${project}/releases/${releaseId}`,
    rulesetName,
  });
}

export async function updateRelease(api, project, releaseId, rulesetName) {
  const name = `projects/${project}/releases/${releaseId}`;
  // https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/patch
  // PATCH v1/projects/{id}/releases/{release} UpdateReleaseRequest {release: {name, rulesetName}} → Release
  // UNVERIFIED: run in spike #5
  return api.patch(`${RULES}/${name}`, { release: { name, rulesetName } });
}
