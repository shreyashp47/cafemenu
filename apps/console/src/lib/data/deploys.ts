/**
 * DeployRequests (types.ts) against the real platform, until the backend
 * (#28) takes requests: every call says so, plainly, and changes nothing.
 *
 * TODO(#28): replace with a callable Cloud Function per request that checks
 * the caller owns the cafe and that it is live and idle, writes a `queued`
 * `deployments/{id}` (trigger "owner"), and returns its id. A worker then
 * runs the deployer for it, and writes steps, result, `release.current` and
 * `release.previous` back:
 *
 *   upgrade        deployer deploy --version <version> --project <id> --site <site> --settings <file>
 *   rollback       deployer rollback --project <id> --site <site>
 *   syncBranding   deployer sync-branding --project <id> --site <site> --settings <file> [--logo <png>]
 *
 * The emulators cannot run the deployer either, so they use this too.
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
