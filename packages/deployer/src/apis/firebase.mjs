/** Firebase Management API: the Firebase project and its registered web apps. */

export const FIREBASE = "https://firebase.googleapis.com/v1beta1";

/** {projectId, projectNumber, displayName, state, …}, or null when it isn't a Firebase project. */
export async function getFirebaseProject(api, project) {
  // https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/get
  // GET v1beta1/projects/{id} → FirebaseProject
  // UNVERIFIED: run in spike #4
  return api.get(`${FIREBASE}/projects/${project}`, { notFound: null });
}

/** The project's ACTIVE web apps: [{appId, displayName, name, state, …}]. */
export async function listWebApps(api, project) {
  // https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects.webApps/list
  // GET v1beta1/projects/{id}/webApps → {apps, nextPageToken}
  // UNVERIFIED: run in spike #4
  return api.list(`${FIREBASE}/projects/${project}/webApps`, "apps");
}

/** Registers a web app and waits for it. Returns the WebApp. */
export async function createWebApp(api, project, displayName) {
  // https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects.webApps/create
  // POST v1beta1/projects/{id}/webApps WebApp {displayName} → Operation (response: WebApp)
  // UNVERIFIED: run in spike #4
  const op = await api.post(`${FIREBASE}/projects/${project}/webApps`, {
    displayName,
  });
  // https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/operations/get
  // UNVERIFIED: run in spike #4
  return api.waitForOperation(FIREBASE, op, {
    what: "Registering the web app",
  });
}

/** {apiKey, appId, authDomain, projectId, storageBucket, messagingSenderId, …} */
export async function getWebAppConfig(api, project, appId) {
  // https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects.webApps/getConfig
  // GET v1beta1/projects/{id}/webApps/{appId}/config → WebAppConfig
  // UNVERIFIED: run in spike #4
  return api.get(`${FIREBASE}/projects/${project}/webApps/${appId}/config`);
}
