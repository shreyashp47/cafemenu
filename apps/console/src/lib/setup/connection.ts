/**
 * "Check connection" (PLAN.md, the owner's step 4): can CafeMenu's deploy
 * account do what it needs in the owner's project? Only the backend can
 * tell, with the platform's service account: `deployer check` tests each
 * permission the deployer's commands need and names each one missing
 * (packages/deployer/src/commands/check.mjs). The console asks through a
 * ConnectionChecker and shows the answer.
 *
 * Here: the answer's shape, the deployer's output turned into it, and the
 * stand-in demo mode and the emulators use.
 */

import { CodedError } from "../data/types";

/** One permission the deploy account lacks, and what it is for. */
export interface MissingPermission {
  permission: string;
  /** "turn on Email/Password and Anonymous sign-in", from the deployer. */
  why: string;
  /** The deployer commands that need it: provision, deploy, owner… */
  neededBy: string[];
}

export type ConnectionResult =
  /** Every permission is there: setup can start. */
  | { status: "connected" }
  /** The account cannot see the project at all, or there is no such project. */
  | { status: "no-access" }
  /** It can see the project, but its role lacks these. */
  | { status: "missing"; missing: MissingPermission[] };

export interface ConnectionChecker {
  check(cafe: { id: string; projectId: string }): Promise<ConnectionResult>;
}

/** What `deployer check` returns: {ok, missing: {command: [{permission, why}]}}. */
export interface DeployerCheck {
  ok: boolean;
  missing: Record<string, { permission: string; why: string }[]>;
}

/**
 * The deployer's answer as the console shows it: each missing permission
 * once, with every command that needs it. (Its "no access" is an
 * ActionNeededError, not a result: the backend sends that as no-access.)
 */
export function fromDeployerCheck(check: DeployerCheck): ConnectionResult {
  const byPermission = new Map<string, MissingPermission>();
  for (const [command, gaps] of Object.entries(check.missing)) {
    for (const { permission, why } of gaps) {
      const seen = byPermission.get(permission);
      if (seen) seen.neededBy.push(command);
      else
        byPermission.set(permission, { permission, why, neededBy: [command] });
    }
  }
  if (check.ok && byPermission.size === 0) return { status: "connected" };
  return { status: "missing", missing: [...byPermission.values()] };
}

/**
 * A sample of what `deployer check` reports when the role is too small,
 * from packages/deployer/src/permissions.mjs, for the stand-in below.
 */
const SAMPLE_GAPS: DeployerCheck = {
  ok: false,
  missing: {
    provision: [
      {
        permission: "datastore.databases.create",
        why: "create the Firestore database",
      },
      {
        permission: "firebaseauth.configs.update",
        why: "turn on Email/Password and Anonymous sign-in",
      },
    ],
    deploy: [
      {
        permission: "firebaserules.releases.update",
        why: "make new rules live",
      },
    ],
  },
};

/**
 * Demo mode's and the emulators' stand-in: nothing is checked, and any
 * project connects, except one whose ID ends in "-noaccess" or "-missing",
 * which answer as a real check would when the member is not there or has
 * too small a role. `delayMs` gives the button time to say "Checking…".
 */
export function simulatedConnectionChecker(delayMs = 0): ConnectionChecker {
  return {
    async check({ projectId }) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (projectId.endsWith("-noaccess")) return { status: "no-access" };
      if (projectId.endsWith("-missing")) return fromDeployerCheck(SAMPLE_GAPS);
      return { status: "connected" };
    },
  };
}

/**
 * Against the real platform.
 *
 * TODO(#28): ask the backend to run `deployer check --project <projectId>`
 * with the platform's service account, for this cafe's owner only (a
 * callable Cloud Function, or a request document it answers), and turn its
 * JSON into a result with fromDeployerCheck; its ActionNeededError for a
 * project the account cannot see is "no-access". The provisioning job runs
 * the same check before it starts, so a cafe is never set up half-allowed.
 * Until then this refuses with "unimplemented", and the page says the
 * maintainer will check by hand; the project ID is saved on the cafe
 * either way.
 */
export const pendingConnectionChecker: ConnectionChecker = {
  async check() {
    throw new CodedError(
      "unimplemented",
      "Checking the connection needs the backend (#28).",
    );
  },
};
