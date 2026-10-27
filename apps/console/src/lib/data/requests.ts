/**
 * ConnectionChecker (src/lib/setup/connection.ts) and DeployRequests
 * (./types.ts) as requests to the backend on GitHub Actions (#77): each is a
 * `requests/{id}` the console writes and then listens to, which the backend's
 * job picks up on its next run (every 5 minutes) and answers on. Switched on
 * with NEXT_PUBLIC_BACKEND=requests (config.ts).
 *
 * A check waits for its answer, which takes minutes, and passes each change
 * of the request to `onProgress` so the page can say how it is going.
 * Upgrade, Roll back and Save branding return at once with the request's id:
 * the owner area watches the cafe's requests (RequestRepository) and its
 * deployments, and shows both as they move.
 *
 * Built on RequestRepository only, so it is tested without Firebase; the
 * Firestore repository is in firestore.ts.
 */

import { FINISHED_REQUEST_STATUSES } from "@cafemenu/shared/requests";
import type { BackendRequest } from "../platform/model";
import type { CheckOptions, ConnectionChecker } from "../setup/connection";
import { parseConnection } from "./callables";
import {
  CodedError,
  type DeployRequests,
  type RequestRepository,
  type Unsubscribe,
} from "./types";

const isFinished = (request: BackendRequest) =>
  FINISHED_REQUEST_STATUSES.includes(request.status);

/**
 * Resolves with request `id` once the backend has finished it, passing every
 * change before that to `onProgress`.
 */
export function untilFinished(
  requests: RequestRepository,
  id: string,
  onProgress?: (request: BackendRequest) => void,
): Promise<BackendRequest> {
  return new Promise((resolve, reject) => {
    let stop: Unsubscribe | null = null;
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      queueMicrotask(() => stop?.());
      settle();
    };
    stop = requests.subscribe(
      id,
      (request) => {
        onProgress?.(request);
        if (isFinished(request)) finish(() => resolve(request));
      },
      (error) => finish(() => reject(error)),
    );
  });
}

/** A failed request as the error its code names, with the backend's words. */
export function requestError(request: BackendRequest): CodedError {
  return new CodedError(
    request.errorCode ?? "unknown",
    request.error ?? "The backend couldn't do it.",
  );
}

export function requestConnectionChecker(
  requests: RequestRepository,
): ConnectionChecker {
  return {
    async check({ id, projectId }, options: CheckOptions = {}) {
      const requestId = await requests.create({
        cafeId: id,
        kind: "check",
        params: { projectId },
      });
      const request = await untilFinished(
        requests,
        requestId,
        options.onProgress,
      );
      if (request.status === "failed") throw requestError(request);
      return parseConnection(request.result);
    },
  };
}

export function requestDeployRequests(
  requests: RequestRepository,
): DeployRequests {
  return {
    async upgrade(cafe, version) {
      return {
        requestId: await requests.create({
          cafeId: cafe.id,
          kind: "deploy",
          params: { version },
        }),
      };
    },
    async rollback(cafe) {
      return {
        requestId: await requests.create({ cafeId: cafe.id, kind: "rollback" }),
      };
    },
    async syncBranding(cafe) {
      return {
        requestId: await requests.create({
          cafeId: cafe.id,
          kind: "sync-branding",
        }),
      };
    },
  };
}
