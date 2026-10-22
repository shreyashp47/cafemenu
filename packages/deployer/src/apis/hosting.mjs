/**
 * Firebase Hosting REST API: sites, and the deploy flow from
 * https://firebase.google.com/docs/hosting/api-deploy
 * (create version → populateFiles → upload → finalize → release).
 */
import { withQuery } from "../http.mjs";

export const HOSTING = "https://firebasehosting.googleapis.com/v1beta1";
const UPLOAD_HOST = "https://upload-firebasehosting.googleapis.com/";

/** The site if it exists in this project, else null. */
export async function getSite(api, project, site) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/projects.sites/get
  // GET v1beta1/projects/{id}/sites/{site} → Site {name, defaultUrl, appId, type}
  // UNVERIFIED: run in spike #4 (what a site owned by another project answers: 404 or 403)
  return api.get(`${HOSTING}/projects/${project}/sites/${site}`, {
    notFound: null,
  });
}

/**
 * Creates a site linked to `appId`. With `validateOnly` nothing is created:
 * Google only says whether the name is free, so dry runs use it too.
 */
export async function createSite(
  api,
  project,
  site,
  { appId, validateOnly } = {},
) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/projects.sites/create
  // POST v1beta1/projects/{id}/sites?siteId={site}[&validateOnly=true] Site {appId} → Site
  // UNVERIFIED: run in spike #4 (the status and message for a name that's taken)
  return api.post(
    withQuery(`${HOSTING}/projects/${project}/sites`, {
      siteId: site,
      validateOnly: validateOnly === true,
    }),
    appId ? { appId } : {},
    { write: !validateOnly },
  );
}

/** Links an existing site to a web app, so /__/firebase/init.json serves that app's config. */
export async function setSiteApp(api, project, site, appId) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/projects.sites/patch
  // PATCH v1beta1/projects/{id}/sites/{site}?updateMask=appId Site {appId} → Site
  // UNVERIFIED: run in spike #4
  return api.patch(
    withQuery(`${HOSTING}/projects/${project}/sites/${site}`, {
      updateMask: "appId",
    }),
    { appId },
  );
}

/** A new version in CREATED state: {name: "sites/{site}/versions/{id}", status, config}. */
export async function createVersion(api, site, config) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions/create
  // POST v1beta1/sites/{site}/versions Version {config} → Version
  // UNVERIFIED: run in spike #5
  return api.post(`${HOSTING}/sites/${site}/versions`, { config });
}

/**
 * Tells Hosting which path has which content hash. Returns {uploadUrl,
 * uploadRequiredHashes}: only content Hosting doesn't already have needs
 * uploading. At most 1000 files per call.
 */
export async function populateFiles(api, versionName, files) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions/populateFiles
  // POST v1beta1/{version}:populateFiles {files: {"/path": sha256}} → {uploadUrl, uploadRequiredHashes}
  // UNVERIFIED: run in spike #5
  return api.post(`${HOSTING}/${versionName}:populateFiles`, { files });
}

/** Uploads one gzipped file to `{uploadUrl}/{hash}`. */
export async function uploadFile(api, uploadUrl, hash, gzipped) {
  if (!uploadUrl.startsWith(UPLOAD_HOST)) {
    throw new Error(`Unexpected Hosting upload URL: ${uploadUrl}`);
  }
  // https://firebase.google.com/docs/hosting/api-deploy (step 5)
  // POST {uploadUrl}/{hash}, Content-Type: application/octet-stream, body: the gzipped bytes → 200
  // UNVERIFIED: run in spike #5
  return api.request("POST", `${uploadUrl}/${hash}`, {
    raw: gzipped,
    contentType: "application/octet-stream",
  });
}

export async function finalizeVersion(api, versionName) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions/patch
  // PATCH v1beta1/{version}?updateMask=status {status: FINALIZED} → Version
  // UNVERIFIED: run in spike #5
  return api.patch(
    withQuery(`${HOSTING}/${versionName}`, { updateMask: "status" }),
    {
      status: "FINALIZED",
    },
  );
}

/** Makes `versionName` live on the site. Used for deploys and rollbacks alike. */
export async function createRelease(api, site, versionName, message) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/create
  // POST v1beta1/sites/{site}/releases?versionName={version} Release {message} → Release
  // UNVERIFIED: run in spike #5
  return api.post(
    withQuery(`${HOSTING}/sites/${site}/releases`, { versionName }),
    message ? { message } : {},
  );
}

/**
 * The live channel's releases, newest first: [{name, version: {name, status,
 * config}, type, releaseTime}]. Hosting keeps the channel's last
 * `retainedReleaseCount` releases (10 by default), so those are the versions
 * a rollback can go back to.
 */
export async function listLiveReleases(api, site, { maxPages = 10 } = {}) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels.releases/list
  // GET v1beta1/sites/{site}/channels/live/releases → {releases, nextPageToken}
  // UNVERIFIED: run in spike #5
  const releases = await api.list(
    `${HOSTING}/sites/${site}/channels/live/releases`,
    "releases",
    { pageSize: 100, maxPages },
  );
  // Sorted here rather than trusting the API's order, which isn't documented.
  return releases.sort((a, b) =>
    String(b.releaseTime ?? "").localeCompare(String(a.releaseTime ?? "")),
  );
}

/** The release the site is serving now, or null if it has never had one. */
export async function getLiveRelease(api, site) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels/get
  // GET v1beta1/sites/{site}/channels/live → Channel {release?: Release}
  // UNVERIFIED: run in spike #5 (what a brand-new site with no release answers)
  const channel = await api.get(`${HOSTING}/sites/${site}/channels/live`, {
    notFound: null,
  });
  return channel?.release ?? null;
}

/** A version: {name, status, config, …}. */
export async function getVersion(api, versionName) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions/get
  // GET v1beta1/{version} → Version
  // UNVERIFIED: run in spike #5
  return api.get(`${HOSTING}/${versionName}`);
}

/** [{path, hash, status}] for every file in a version. */
export async function listVersionFiles(api, versionName) {
  // https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions.files/list
  // GET v1beta1/{version}/files → {files: [{path, hash, status}], nextPageToken}
  // UNVERIFIED: run in spike #5
  return api.list(`${HOSTING}/${versionName}/files`, "files", {
    pageSize: 1000,
    maxPages: 200,
  });
}
