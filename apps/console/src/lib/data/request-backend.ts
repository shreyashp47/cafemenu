/**
 * ConnectionChecker (src/lib/setup/connection.ts) and DeployRequests
 * (./types.ts) as requests: the console writes a `requests/{id}` and watches
 * it, and the platform's worker (apps/platform-functions, run by a schedule on
 * GitHub Actions) answers on the same document. Switched on with
 * NEXT_PUBLIC_BACKEND=requests (config.ts).
 *
 * Unlike a callable, this does not answer at once: the worker runs every five
 * minutes, so a check takes a few minutes and a deploy longer. A check waits
 * and reports progress as it goes; a deploy returns as soon as it is asked,
 * and the owner area watches the request (./types.ts, RequestRepository).
 *
 * The rules (firestore.rules) hold the asker to their own cafe; the worker
 * checks again, and fails the request with a Firebase-style code and words,
 * which are the ones the pages already have words for.
 */

import type {
  BackendRequest,
  RequestKind,
  RequestStatus,
} from "../platform/model";
import type { ConnectionChecker } from "../setup/connection";
import { codedFrom, parseConnection } from "./callables";
import {
  CodedError,
  type DeployRequests,
  type ErrorListener,
  type Listener,
  type RequestProgress,
  type Unsubscribe,
} from "./types";

/** The two things the console does with a request, apart from where it is kept. */
export interface RequestTransport {
  /** Writes the request, as the signed-in owner, and returns its id. */
  create(
    cafeId: string,
    kind: RequestKind,
    params: Record<string, string>,
  ): Promise<string>;
  /** Live view of one request; null if it is not there. */
  watch(
    id: string,
    listener: Listener<BackendRequest | null>,
    onError: ErrorListener,
  ): Unsubscribe;
}

/** How long a check waits for the worker before it says it hasn't heard. */
export const CHECK_WAIT_MS = 15 * 60_000;

export const progressOf = (
  request: Pick<BackendRequest, "status" | "steps" | "detail">,
): RequestProgress => ({
  status: request.status,
  steps: request.steps,
  detail: request.detail,
});

/**
 * "Check connection" through a `check` request. Resolves with the worker's
 * answer; rejects with its code and words if the request failed, or with
 * `deadline-exceeded` if nothing has answered after `waitMs` (the schedule
 * may be paused). The request is left as it is: the worker may still answer
 * it later, and a second check is a second request.
 */
export function requestConnectionChecker(
  transport: RequestTransport,
  { waitMs = CHECK_WAIT_MS }: { waitMs?: number } = {},
): ConnectionChecker {
  return {
    async check({ id, projectId }, options) {
      let requestId: string;
      try {
        requestId = await transport.create(id, "check", { projectId });
      } catch (error) {
        throw codedFrom(error);
      }
      return new Promise((resolve, reject) => {
        let stop: Unsubscribe = () => {};
        let settled = false;
        const end = (finish: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          stop();
          finish();
        };
        const timer = setTimeout(
          () =>
            end(() =>
              reject(
                new CodedError(
                  "deadline-exceeded",
                  "The backend didn't answer in time.",
                ),
              ),
            ),
          waitMs,
        );
        stop = transport.watch(
          requestId,
          (request) => {
            if (!request) return;
            options?.onProgress?.(progressOf(request));
            if (request.status === "done") {
              end(() => {
                try {
                  resolve(parseConnection(request.result));
                } catch (error) {
                  reject(codedFrom(error));
                }
              });
            } else if (request.status === "failed") {
              end(() => reject(failure(request)));
            }
          },
          (error) => end(() => reject(codedFrom(error))),
        );
        // The listener may have answered before `stop` was assigned.
        if (settled) stop();
      });
    },
  };
}

/** The error a failed request stands for. */
export function failure(
  request: Pick<BackendRequest, "error" | "errorCode">,
): CodedError {
  return new CodedError(
    request.errorCode ?? "unknown",
    request.error ?? "The request failed.",
  );
}

/**
 * Upgrade, Roll back and Save branding as requests. Each returns once the
 * request is written; whether the worker can do it (the cafe is live, nothing
 * else is running…) is its answer, which the owner area shows from the
 * request.
 */
export function requestDeployRequests(
  transport: RequestTransport,
): DeployRequests {
  const ask = async (
    cafe: { id: string },
    kind: RequestKind,
    params: Record<string, string> = {},
  ) => {
    try {
      return { requestId: await transport.create(cafe.id, kind, params) };
    } catch (error) {
      throw codedFrom(error);
    }
  };
  return {
    upgrade: (cafe, version) => ask(cafe, "deploy", { version }),
    rollback: (cafe) => ask(cafe, "rollback"),
    syncBranding: (cafe) => ask(cafe, "sync-branding"),
  };
}

/** Whether the worker has not finished with the request. */
export const isOpen = (status: RequestStatus): boolean =>
  status === "queued" || status === "running";
