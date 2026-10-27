/**
 * DeployRequests (types.ts) against the real platform when the backend's
 * functions are not switched on (NEXT_PUBLIC_BACKEND_FUNCTIONS, config.ts):
 * every call says so, plainly, and changes nothing.
 *
 * With the switch on, callables.ts takes over: a callable Cloud Function per
 * request (apps/platform-functions) checks the caller owns the cafe and that
 * it is live and idle, writes a `queued` `deployments/{id}` (trigger
 * "owner"), and returns its id. A worker then runs the deployer for it, and
 * writes steps, result, `release.current` and `release.previous` back.
 *
 * The emulators use this too, unless the functions emulator is on.
 */

import { CodedError, type DeployRequests } from "./types";

const pending = () =>
  Promise.reject(
    new CodedError(
      "backend-pending",
      "The backend does not take deploy requests yet.",
    ),
  );

export const pendingDeployRequests: DeployRequests = {
  upgrade: pending,
  rollback: pending,
  syncBranding: pending,
};
