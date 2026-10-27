/**
 * ConnectionChecker (src/lib/setup/connection.ts) and DeployRequests
 * (./types.ts) against the platform's Cloud Functions, apps/platform-functions:
 * one callable per request. Switched on with NEXT_PUBLIC_BACKEND_FUNCTIONS
 * (config.ts); without it the stand-ins and the "backend-pending" answers in
 * ./deploys.ts stay.
 *
 * The functions check the caller (the cafe's owner, or the admin) and the
 * cafe's state, and refuse with the codes the pages already have words for:
 * permission-denied, failed-precondition, invalid-argument. A request that
 * passes becomes a queued `deployments/{id}` that DeploymentRepository shows.
 */

import { CodedError, type DeployRequests, type DeployReceipt } from "./types";
import type { ConnectionChecker, ConnectionResult } from "../setup/connection";

/** Calls the named function with `data` and returns what it answers. */
export type Call = (
  name: string,
  data: Record<string, unknown>,
) => Promise<unknown>;

/** A Functions error, "functions/permission-denied", as the plain Firebase-style code. */
export function codedFrom(error: unknown): Error {
  if (error instanceof CodedError) return error;
  const { code, message } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
  };
  if (typeof code === "string") {
    return new CodedError(
      code.replace(/^functions\//, ""),
      typeof message === "string" ? message : code,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const malformed = () =>
  new CodedError("internal", "The backend's answer was not understood.");

/** The backend's answer to a check, from a callable or a request (requests.ts). */
export function parseConnection(value: unknown): ConnectionResult {
  if (!isRecord(value)) throw malformed();
  if (value.status === "connected" || value.status === "no-access") {
    return { status: value.status };
  }
  if (value.status === "missing" && Array.isArray(value.missing)) {
    return {
      status: "missing",
      missing: value.missing.filter(
        (m): m is { permission: string; why: string; neededBy: string[] } =>
          isRecord(m) &&
          typeof m.permission === "string" &&
          typeof m.why === "string" &&
          Array.isArray(m.neededBy),
      ),
    };
  }
  throw malformed();
}

function parseReceipt(value: unknown): DeployReceipt {
  if (!isRecord(value) || typeof value.deploymentId !== "string") {
    throw malformed();
  }
  return { deploymentId: value.deploymentId };
}

export function callableConnectionChecker(call: Call): ConnectionChecker {
  return {
    async check({ id, projectId }) {
      try {
        return parseConnection(
          await call("checkConnection", { cafeId: id, projectId }),
        );
      } catch (error) {
        throw codedFrom(error);
      }
    },
  };
}

export function callableDeployRequests(call: Call): DeployRequests {
  const request = async (name: string, data: Record<string, unknown>) => {
    try {
      return parseReceipt(await call(name, data));
    } catch (error) {
      throw codedFrom(error);
    }
  };
  return {
    upgrade: (cafe, version) =>
      request("requestUpgrade", { cafeId: cafe.id, version }),
    rollback: (cafe) => request("requestRollback", { cafeId: cafe.id }),
    syncBranding: (cafe) => request("requestSyncBranding", { cafeId: cafe.id }),
  };
}
