/** Types for requests.mjs: requests to CafeMenu's backend (#77). */

export type RequestKind =
  "provision" | "check" | "deploy" | "rollback" | "sync-branding";

export type RequestStatus = "queued" | "running" | "done" | "failed";

export const REQUEST_KINDS: readonly RequestKind[];
export const DEPLOYMENT_REQUEST_KINDS: readonly RequestKind[];
export const REQUEST_STATUSES: readonly RequestStatus[];
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[];
export const FINISHED_REQUEST_STATUSES: readonly RequestStatus[];

export const CAFE_ID: RegExp;
export const PROJECT_ID: RegExp;
export const RELEASE_VERSION: RegExp;

/** What each kind takes. */
export interface RequestParams {
  provision: Record<string, never>;
  check: { projectId: string };
  deploy: { version: string };
  rollback: Record<string, never>;
  "sync-branding": Record<string, never>;
}

export type RequestParamsProblem = "kind" | "params" | "project-id" | "version";

export function requestParamsProblem(
  kind: unknown,
  params: unknown,
): RequestParamsProblem | null;

export interface NewRequest {
  cafeId: string;
  kind: RequestKind;
  /** What the kind takes (RequestParams); checked when the record is made. */
  params?: Record<string, unknown>;
  by: string;
}

export interface RequestRecord<T = unknown> {
  cafeId: string;
  kind: RequestKind;
  params: Record<string, unknown>;
  status: "queued";
  createdAt: T;
  by: string;
}

export function newRequestRecord<T>(
  request: NewRequest,
  createdAt: T,
): RequestRecord<T>;

export function isOpenRequest(status: unknown): boolean;
