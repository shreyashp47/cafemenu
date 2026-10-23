/**
 * Where the owner's steps send them in Google's consoles. With a project ID
 * the links open that project; without one, the console's own picker.
 */

import { isProjectId } from "../platform/validate";

const FIREBASE = "https://console.firebase.google.com";

const project = (projectId: string | null | undefined) =>
  projectId && isProjectId(projectId) ? projectId : null;

/** The Firebase console: where a project is created. */
export const firebaseConsoleUrl = () => `${FIREBASE}/`;

/** Project settings → Users and permissions, where the member is added. */
export function usersAndPermissionsUrl(projectId?: string | null): string {
  const id = project(projectId);
  return id ? `${FIREBASE}/project/${id}/settings/iam` : `${FIREBASE}/`;
}

/** Project settings → General, where the project ID is shown. */
export function projectSettingsUrl(projectId?: string | null): string {
  const id = project(projectId);
  return id ? `${FIREBASE}/project/${id}/settings/general` : `${FIREBASE}/`;
}

/**
 * The Google Cloud IAM page. The Firebase console does not list service
 * accounts among a project's members, so this is where CafeMenu's deploy
 * account can be seen, and removed (docs/legal/access-explained.md).
 */
export function cloudIamUrl(projectId?: string | null): string {
  const id = project(projectId);
  const base = "https://console.cloud.google.com/iam-admin/iam";
  return id ? `${base}?project=${encodeURIComponent(id)}` : base;
}
