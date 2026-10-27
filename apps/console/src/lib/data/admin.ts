/**
 * AdminRequests (types.ts) against the real platform, until the backend
 * (#28, and the rollouts of #32) takes them: publishing and rollouts say so,
 * plainly, and change nothing. There are no rollouts to watch yet, so that
 * is an empty list rather than an error.
 *
 * TODO(#28): publishRelease becomes a callable Cloud Function that checks
 * the caller's `admin` claim, downloads `v<version>` from GitHub, verifies it
 * (scripts/release/verify.mjs) against the version, channel and schema in the
 * request, and writes `releases/{version}`.
 * TODO(#32): `rollout` becomes the same, running `deployer rollout --version
 * <version> --cafes <the cafes collection>` (start) or `--resume <id>`, and
 * the rollouts become `rollouts/{id}` documents read here, with rules that
 * let only the admin read them.
 */

import { CodedError, type AdminRequests } from "./types";

const pending = () =>
  Promise.reject(
    new CodedError(
      "admin-pending",
      "The backend does not take admin requests yet.",
    ),
  );

export const pendingAdminRequests: AdminRequests = {
  publishRelease: pending,
  subscribeRollouts(listener) {
    listener({});
    return () => {};
  },
  rollout: pending,
};
