/** Types for requests.mjs: requests to CafeMenu's backend (#77). */

export type OwnerRequestKind =
  "provision" | "check" | "deploy" | "rollback" | "sync-branding";

export type AdminRequestKind =
  | "suspend"
  | "reactivate"
  | "delete-owner"
  | "maintenance-on"
  | "maintenance-off"
  | "appoint-admin"
  | "remove-admin";

export type RequestKind = OwnerRequestKind | AdminRequestKind;

export type RequestStatus = "queued" | "running" | "done" | "failed";

export const OWNER_REQUEST_KINDS: readonly OwnerRequestKind[];
export const ADMIN_REQUEST_KINDS: readonly AdminRequestKind[];
export const CAFELESS_REQUEST_KINDS: readonly AdminRequestKind[];
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

export type RequestParamsProblem =
  | "kind"
  | "params"
  | "project-id"
  | "version"
  | "reason"
  | "note"
  | "time"
  | "message"
  | "batch"
  | "confirm"
  | "email";

export function requestParamsProblem(
  kind: unknown,
  params: unknown,
): RequestParamsProblem | null;

export interface NewRequest {
  /** Null for the admin kinds about an account (CAFELESS_REQUEST_KINDS). */
  cafeId: string | null;
  kind: RequestKind;
  /** What the kind takes (RequestParams); checked when the record is made. */
  params?: Record<string, unknown>;
  by: string;
}

export interface RequestRecord<T = unknown> {
  cafeId: string | null;
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
export function isAdminRequestKind(kind: unknown): kind is AdminRequestKind;
