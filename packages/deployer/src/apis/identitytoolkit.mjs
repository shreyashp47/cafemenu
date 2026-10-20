/**
 * Identity Toolkit (Firebase Authentication): the project's sign-in settings
 * (admin v2) and its user accounts (v1, called as the project's admin with
 * an OAuth token, so no API key is needed).
 */
import { ApiError } from "../errors.mjs";
import { withQuery } from "../http.mjs";

export const IDENTITY_TOOLKIT_V1 = "https://identitytoolkit.googleapis.com/v1";
export const IDENTITY_TOOLKIT_V2 = "https://identitytoolkit.googleapis.com/v2";

/**
 * The project's Auth config, or null when Authentication hasn't been set up
 * in the project yet (Google answers CONFIGURATION_NOT_FOUND).
 */
export async function getAuthConfig(api, project) {
  try {
    // https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/getConfig
    // GET v2/projects/{id}/config → Config {signIn: {email, anonymous, …}, …}
    // UNVERIFIED: run in spike #4
    return await api.get(`${IDENTITY_TOOLKIT_V2}/projects/${project}/config`, {
      notFound: null,
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      /CONFIGURATION_NOT_FOUND/.test(error.reason)
    ) {
      return null;
    }
    throw error;
  }
}

/** Writes only the fields named in `updateMask` (e.g. "signIn.anonymous.enabled"). */
export async function updateAuthConfig(api, project, config, updateMask) {
  // https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig
  // PATCH v2/projects/{id}/config?updateMask=a.b,c.d Config → Config
  // UNVERIFIED: run in spike #4 (not yet known to work on Spark without Identity Platform)
  return api.patch(
    withQuery(`${IDENTITY_TOOLKIT_V2}/projects/${project}/config`, {
      updateMask: updateMask.join(","),
    }),
    config,
  );
}

/** The account with this email ({localId, email, displayName, passwordUpdatedAt, …}), or null. */
export async function lookupUserByEmail(api, project, email) {
  // https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup
  // POST v1/projects/{id}/accounts:lookup {email: [..]} → {users?: [UserInfo]}
  // UNVERIFIED: run in spike #6
  const res = await api.post(
    `${IDENTITY_TOOLKIT_V1}/projects/${project}/accounts:lookup`,
    { email: [email] },
    { write: false },
  );
  return res.users?.[0] ?? null;
}

/**
 * Creates an email account with no password. The owner picks one from the
 * password-reset email, so no password is ever generated, shown or sent.
 */
export async function createUser(api, project, { email, displayName }) {
  // https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects/accounts
  // POST v1/projects/{id}/accounts SignUpRequest {email, displayName, emailVerified} → {localId}
  // UNVERIFIED: run in spike #6 (that an admin may create an email user without a password)
  return api.post(`${IDENTITY_TOOLKIT_V1}/projects/${project}/accounts`, {
    email,
    displayName,
    emailVerified: false,
  });
}

/** Sends the project's own "reset your password" email. */
export async function sendPasswordResetEmail(api, project, email, continueUrl) {
  // https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/sendOobCode
  // POST v1/projects/{id}/accounts:sendOobCode {requestType: PASSWORD_RESET, email, continueUrl?} → {email}
  // UNVERIFIED: run in spike #6
  const body = { requestType: "PASSWORD_RESET", email };
  if (continueUrl) body.continueUrl = continueUrl;
  return api.post(
    `${IDENTITY_TOOLKIT_V1}/projects/${project}/accounts:sendOobCode`,
    body,
  );
}
