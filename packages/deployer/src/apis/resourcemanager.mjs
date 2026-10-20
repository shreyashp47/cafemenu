/** Cloud Resource Manager: which permissions the caller has on a project. */

export const RESOURCE_MANAGER =
  "https://cloudresourcemanager.googleapis.com/v3";

/**
 * Returns the subset of `permissions` the caller holds on the project. The
 * call itself needs no permission, but answers 403 when the caller has no
 * access to the project at all.
 */
export async function testPermissions(api, project, permissions) {
  const held = [];
  for (let i = 0; i < permissions.length; i += 100) {
    // https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/testIamPermissions
    // POST v3/projects/{id}:testIamPermissions {permissions} → {permissions}
    // UNVERIFIED: run in spike #3
    const res = await api.post(
      `${RESOURCE_MANAGER}/projects/${project}:testIamPermissions`,
      { permissions: permissions.slice(i, i + 100) },
      { write: false },
    );
    held.push(...(res.permissions ?? []));
  }
  return held;
}
