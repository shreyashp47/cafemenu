/**
 * The IAM permissions each command needs on the cafe's project, and why.
 * `deployer check` tests exactly these, so this list is the starting point
 * for the smallest role set (issue #3). Taken from the IAM reference for each
 * API; none of it has been tried against a real project yet.
 *
 *   https://docs.cloud.google.com/iam/docs/roles-permissions/firebasehosting
 *   https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth
 *   https://docs.cloud.google.com/iam/docs/roles-permissions/firebaserules
 *   https://docs.cloud.google.com/iam/docs/roles-permissions/serviceusage
 *   https://docs.cloud.google.com/firestore/native/docs/security/iam
 *   https://firebase.google.com/docs/projects/iam/permissions
 */

export const PERMISSIONS = {
  provision: [
    ["firebase.projects.get", "look up the Firebase project and its number"],
    ["serviceusage.services.get", "see which APIs are already on"],
    ["serviceusage.services.enable", "turn on the APIs the cafe app needs"],
    ["serviceusage.operations.get", "wait for the APIs to finish turning on"],
    [
      "datastore.databases.getMetadata",
      "see whether the Firestore database exists",
    ],
    ["datastore.databases.create", "create the Firestore database"],
    ["datastore.operations.get", "wait for the database to be created"],
    ["firebaseauth.configs.get", "read the sign-in settings"],
    [
      "firebaseauth.configs.update",
      "turn on Email/Password and Anonymous sign-in",
    ],
    ["firebase.clients.list", "find the CafeMenu web app"],
    ["firebase.clients.create", "register the CafeMenu web app"],
    ["firebase.clients.get", "read the web app's config"],
    ["firebasehosting.sites.get", "see whether the Hosting site exists"],
    ["firebasehosting.sites.create", "create the cafe's Hosting site"],
    ["firebasehosting.sites.update", "link the site to the web app"],
  ],
  deploy: [
    ["firebaserules.releases.get", "read which rules are live"],
    ["firebaserules.rulesets.get", "compare the live rules with the release's"],
    ["firebaserules.rulesets.create", "upload new rules"],
    ["firebaserules.releases.create", "make rules live the first time"],
    ["firebaserules.releases.update", "make new rules live"],
    ["datastore.indexes.list", "see which indexes exist"],
    ["datastore.indexes.create", "create missing indexes"],
    ["firebasehosting.sites.get", "read the live Hosting version"],
    [
      "firebasehosting.sites.update",
      "create, upload, finalize and release a version",
    ],
    ["datastore.entities.get", "read config/meta and config/site"],
    ["datastore.entities.create", "write config/site the first time"],
    ["datastore.entities.update", "write config/site"],
  ],
  rollback: [
    ["firebasehosting.sites.get", "list the site's past releases"],
    ["firebasehosting.sites.update", "release an earlier version again"],
    ["datastore.entities.get", "read config/meta's schema version"],
    ["firebaserules.releases.get", "read which rules are live"],
    ["firebaserules.rulesets.get", "check the earlier rules still exist"],
    ["firebaserules.releases.update", "make the earlier rules live again"],
  ],
  "sync-branding": [
    ["datastore.entities.get", "read config/site"],
    ["datastore.entities.create", "write config/site the first time"],
    ["datastore.entities.update", "write config/site"],
    ["firebasehosting.sites.get", "read the live Hosting version's files"],
    [
      "firebasehosting.sites.update",
      "create and release a version with the new branding",
    ],
  ],
  owner: [
    ["firebaseauth.users.get", "find the owner's account"],
    ["firebaseauth.users.create", "create the owner's account"],
    ["firebaseauth.users.sendEmail", "send the set-password email"],
    ["datastore.entities.get", "read /staff/{uid}"],
    ["datastore.entities.create", "create /staff/{uid}"],
    ["datastore.entities.update", "update /staff/{uid}"],
  ],
};

export const COMMANDS_WITH_PERMISSIONS = Object.keys(PERMISSIONS);

/** Every distinct permission the given commands need, in a stable order. */
export function permissionsFor(commands = COMMANDS_WITH_PERMISSIONS) {
  return [...new Set(commands.flatMap((c) => PERMISSIONS[c].map(([p]) => p)))];
}
