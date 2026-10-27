/**
 * The super admin's directory and actions (#78) in demo mode: AdminDirectory
 * (types.ts) over demo-store.ts. The demo's backend answers at once, as
 * demo-deploys.ts does for the owner: an action is checked as the rules
 * check the request, then done as the worker does it
 * (apps/platform-functions/src/worker/admin.mjs), with a log entry and the
 * emails recorded (never sent). A suspension with a notice period waits,
 * queued, for its date, as on the real backend; nothing in the demo picks it
 * up later.
 */

import {
  ADMIN_POLICY,
  REASON_LABELS,
  earliestEffect,
  type AdminPolicy,
  type AnyReason,
} from "@cafemenu/shared/admin-policy";
import {
  newRequestRecord,
  type AdminRequestKind,
} from "@cafemenu/shared/requests";
import { maintenanceRecord } from "@cafemenu/shared/maintenance";
import type {
  AdminLogEntry,
  AdminReason,
  BackendRequest,
  Cafe,
  OwnerRecord,
  PlatformUser,
} from "../platform/model";
import { sampleOwnerName } from "./demo-sample";
import {
  currentUser,
  makeId,
  mutate,
  saveSetup,
  type DemoState,
} from "./demo-store";
import {
  CodedError,
  HISTORY_LIMIT,
  type AdminDirectory,
  type Listener,
  type Unsubscribe,
} from "./types";

/** A time picked in a form is taken as meant if it is at most this early. */
const SLACK_MS = 10 * 60_000;

/** What demo.ts lends: its live reads and its rules' admin check. */
export interface DemoAdminDeps {
  live<T>(read: (state: DemoState) => T, listener: Listener<T>): Unsubscribe;
  isAdmin(state: DemoState): boolean;
  /** The policy; tests pass another. */
  policy?: AdminPolicy;
}

const denied = () =>
  new CodedError("permission-denied", "Missing or insufficient permissions.");

/** Every account in the directory: the demo's own, and the sample owners. */
export function demoOwners(state: DemoState): OwnerRecord[] {
  const records = new Map<string, OwnerRecord>();
  const base = (uid: string, email: string, createdAt: number | null) => ({
    uid,
    email,
    name: sampleOwnerName(uid),
    createdAt,
    lastSignInAt: null,
    admin: false,
    disabled: false,
    status: "active" as const,
    statusReason: null,
    statusChangedAt: null,
  });
  for (const account of state.accounts) {
    records.set(account.uid, {
      ...base(account.uid, account.email, null),
      admin: account.isAdmin === true,
    });
  }
  for (const cafe of state.cafes) {
    if (records.has(cafe.ownerUid)) continue;
    records.set(cafe.ownerUid, {
      ...base(cafe.ownerUid, cafe.ownerEmail, cafe.createdAt),
      lastSignInAt: cafe.updatedAt,
    });
  }
  for (const [uid, entry] of Object.entries(state.owners)) {
    const record = records.get(uid);
    if (!record) continue;
    records.set(uid, {
      ...record,
      status: entry.status,
      disabled: entry.status === "suspended",
      statusReason: entry.statusReason,
      statusChangedAt: entry.statusChangedAt,
    });
  }
  return [...records.values()];
}

/** Whether the demo account `uid` is suspended: its sign-in is refused. */
export const isSuspendedAccount = (state: DemoState, uid: string) =>
  state.owners[uid]?.status === "suspended";

// -- the actions -------------------------------------------------------------------

interface Job {
  state: DemoState;
  request: BackendRequest;
  admin: PlatformUser;
  policy: AdminPolicy;
  now: number;
}

type Outcome = Partial<BackendRequest>;

const fail = (code: string, message: string) => new CodedError(code, message);

function reasonOf(params: Record<string, unknown>): AdminReason {
  return {
    code: typeof params.reason === "string" ? params.reason : null,
    note: typeof params.note === "string" ? params.note.trim() : "",
  };
}

const labelOf = (reason: AdminReason) =>
  reason.code ? (REASON_LABELS[reason.code as AnyReason] ?? reason.code) : "";

function cafeOf(job: Job): Cafe {
  const cafe = job.state.cafes.find((c) => c.id === job.request.cafeId);
  if (!cafe) throw fail("not-found", "No such cafe.");
  return cafe;
}

/** As the worker's checkNotice: a reason with notice can't take effect sooner. */
function checkNotice(job: Job, reason: AdminReason, at: number | null) {
  if (!reason.code) return;
  const earliest = earliestEffect(reason.code, job.now, job.policy);
  if (earliest - job.now <= 0) return;
  if (at === null || at < earliest - SLACK_MS) {
    throw fail(
      "failed-precondition",
      `${labelOf(reason)} needs notice: not before ${new Date(earliest).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    );
  }
}

function log(
  job: Job,
  entry: Pick<AdminLogEntry, "cafeId" | "ownerUid" | "reason" | "details">,
) {
  // Under the request's id, as the backend writes it: once.
  if (job.state.adminLog.some((e) => e.id === job.request.id)) return;
  job.state.adminLog.unshift({
    id: job.request.id,
    at: job.now,
    by: job.admin.uid,
    byEmail: job.admin.email,
    action: job.request.kind,
    ...entry,
  });
}

function email(job: Job, cafeId: string, kind: string) {
  job.state.emails.unshift({ id: makeId("email"), cafeId, kind, at: job.now });
}

/** A time from the params: a Date as written, or what JSON made of one. */
function time(value: unknown): number | null {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : NaN;
  return Number.isFinite(ms) ? ms : null;
}

const ownersCafes = (state: DemoState, uid: string) =>
  state.cafes.filter((c) => c.ownerUid === uid);

function suspend(job: Job): Outcome {
  const { state, request, now } = job;
  const reason = reasonOf(request.params);
  const effectiveAt = time(request.params.effectiveAt);
  checkNotice(job, reason, effectiveAt);
  const cafe = cafeOf(job);
  if (effectiveAt !== null && effectiveAt > now) {
    email(job, cafe.id, "suspension-notice");
    return {
      status: "queued",
      notBefore: effectiveAt,
      progress: {
        steps: [],
        detail: `Scheduled for ${new Date(effectiveAt).toISOString()}.`,
      },
    };
  }
  const uid = cafe.ownerUid;
  const entry = (state.owners[uid] ??= {
    status: "active",
    statusReason: null,
    statusChangedAt: null,
    cafesBefore: {},
  });
  const cafes = ownersCafes(state, uid);
  for (const c of cafes) {
    if (c.status !== "suspended") entry.cafesBefore[c.id] = c.status;
    c.status = "suspended";
    c.statusReason = reason;
    c.statusChangedAt = now;
    c.updatedAt = now;
  }
  Object.assign(entry, {
    status: "suspended",
    statusReason: reason,
    statusChangedAt: now,
  });
  log(job, {
    cafeId: cafe.id,
    ownerUid: uid,
    reason,
    details: { cafes: cafes.map((c) => c.id) },
  });
  email(job, cafe.id, "account-suspended");
  return { status: "done", result: { ownerUid: uid, emailed: 1 } };
}

function reactivate(job: Job): Outcome {
  const { state, request, now } = job;
  const reason = reasonOf(request.params);
  const cafe = cafeOf(job);
  const uid = cafe.ownerUid;
  const cancelled: string[] = [];
  for (const r of state.requests) {
    if (r.kind === "suspend" && r.cafeId === cafe.id && r.status === "queued") {
      Object.assign(r, {
        status: "failed",
        errorCode: "cancelled",
        error: "Called off: the account was reactivated first.",
        finishedAt: now,
      });
      cancelled.push(r.id);
    }
  }
  const entry = state.owners[uid];
  const cafes = ownersCafes(state, uid);
  for (const c of cafes) {
    if (c.status !== "suspended") continue;
    c.status = entry?.cafesBefore[c.id] ?? "live";
    c.statusReason = reason;
    c.statusChangedAt = now;
    c.updatedAt = now;
  }
  state.owners[uid] = {
    status: "active",
    statusReason: reason,
    statusChangedAt: now,
    cafesBefore: {},
  };
  log(job, {
    cafeId: cafe.id,
    ownerUid: uid,
    reason,
    details: { cafes: cafes.map((c) => c.id), cancelled },
  });
  email(job, cafe.id, "account-reactivated");
  return { status: "done", result: { ownerUid: uid, emailed: 1 } };
}

function deleteOwner(job: Job): Outcome {
  const { state, request } = job;
  const reason = reasonOf(request.params);
  const cafe = cafeOf(job);
  if (request.params.confirm !== cafe.site) {
    throw fail(
      "invalid-argument",
      "The web address typed doesn't match the cafe's.",
    );
  }
  const uid = cafe.ownerUid;
  if (state.accounts.some((a) => a.uid === uid && a.isAdmin)) {
    throw fail("failed-precondition", "That account is an admin.");
  }
  const cafes = ownersCafes(state, uid).map((c) => c.id);
  // The notice goes before the record does; the log stays.
  log(job, {
    cafeId: cafe.id,
    ownerUid: uid,
    reason,
    details: { cafes, site: cafe.site, projectId: cafe.projectId },
  });
  state.cafes = state.cafes.filter((c) => c.ownerUid !== uid);
  state.deployments = state.deployments.filter((d) => d.ownerUid !== uid);
  state.emails = state.emails.filter((e) => !cafes.includes(e.cafeId));
  state.accounts = state.accounts.filter((a) => a.uid !== uid);
  if (state.session === uid) state.session = null;
  delete state.owners[uid];
  for (const id of cafes) {
    saveSetup(id, "logo", null);
    saveSetup(id, "menu", null);
  }
  return { status: "done", result: { ownerUid: uid, cafes, emailed: 1 } };
}

function maintenanceOn(job: Job): Outcome {
  const { request, now } = job;
  const params = request.params;
  const reason = reasonOf(params);
  const startsAt = time(params.startsAt);
  checkNotice(job, reason, startsAt);
  const cafe = cafeOf(job);
  if (!cafe.projectId || cafe.status === "draft") {
    throw fail(
      "failed-precondition",
      "This cafe has no site yet: there is nothing to put into maintenance.",
    );
  }
  const record = maintenanceRecord(
    {
      by: "admin",
      message: typeof params.message === "string" ? params.message : "",
      until: time(params.until),
      startsAt,
      endsAt: time(params.endsAt),
    },
    now,
    (ms) => ms,
  );
  cafe.maintenance = {
    ...record,
    reason,
    setAt: now,
    setBy: job.admin.uid,
    batch: typeof params.batch === "string" ? params.batch : null,
  };
  cafe.updatedAt = now;
  log(job, {
    cafeId: cafe.id,
    ownerUid: cafe.ownerUid,
    reason,
    details: {
      message: record.message,
      until: record.until,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      batch: cafe.maintenance.batch,
    },
  });
  email(job, cafe.id, "maintenance-on");
  return { status: "done", result: { cafeId: cafe.id, emailed: 1 } };
}

function maintenanceOff(job: Job): Outcome {
  const { request, now } = job;
  const cafe = cafeOf(job);
  cafe.maintenance = null;
  cafe.updatedAt = now;
  log(job, {
    cafeId: cafe.id,
    ownerUid: cafe.ownerUid,
    reason: { code: null, note: reasonOf(request.params).note },
    details: {
      batch:
        typeof request.params.batch === "string" ? request.params.batch : null,
    },
  });
  email(job, cafe.id, "maintenance-off");
  return { status: "done", result: { cafeId: cafe.id, emailed: 1 } };
}

function accountByEmail(state: DemoState, address: unknown) {
  const wanted = String(address).trim().toLowerCase();
  const account = state.accounts.find((a) => a.email.toLowerCase() === wanted);
  if (!account) throw fail("not-found", "No CafeMenu account has that email.");
  return account;
}

function appointAdmin(job: Job): Outcome {
  if (!job.policy.appointOtherAdmins) {
    throw fail(
      "failed-precondition",
      "Appointing admins is off for now: only the first admin.",
    );
  }
  const account = accountByEmail(job.state, job.request.params.email);
  account.isAdmin = true;
  log(job, {
    cafeId: null,
    ownerUid: account.uid,
    reason: { code: null, note: reasonOf(job.request.params).note },
    details: { email: account.email },
  });
  return { status: "done", result: { uid: account.uid } };
}

function removeAdmin(job: Job): Outcome {
  const account = accountByEmail(job.state, job.request.params.email);
  const admins = job.state.accounts.filter((a) => a.isAdmin);
  if (account.isAdmin && admins.length <= 1) {
    throw fail("failed-precondition", "The last admin can't be removed.");
  }
  account.isAdmin = false;
  log(job, {
    cafeId: null,
    ownerUid: account.uid,
    reason: { code: null, note: reasonOf(job.request.params).note },
    details: { email: account.email },
  });
  return { status: "done", result: { uid: account.uid } };
}

const HANDLERS: Record<AdminRequestKind, (job: Job) => Outcome> = {
  suspend,
  reactivate,
  "delete-owner": deleteOwner,
  "maintenance-on": maintenanceOn,
  "maintenance-off": maintenanceOff,
  "appoint-admin": appointAdmin,
  "remove-admin": removeAdmin,
};

// -- the directory -----------------------------------------------------------------

const newestFirst = <T extends { at: number }>(list: T[]) =>
  [...list].sort((a, b) => b.at - a.at);

export function demoAdminDirectory({
  live,
  isAdmin,
  policy = ADMIN_POLICY,
}: DemoAdminDeps): AdminDirectory {
  /** A live read the rules let only the admin make. */
  function adminRead<T>(
    read: (state: DemoState) => T,
    listener: Listener<T>,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    let failed = false;
    return live(
      (state) => (isAdmin(state) ? { value: read(state) } : null),
      (result) => {
        if (result) listener(result.value);
        else if (!failed) {
          failed = true;
          onError?.(denied());
        }
      },
    );
  }

  return {
    canAct: true,
    subscribeOwners(listener, onError) {
      return adminRead(demoOwners, listener, onError);
    },
    subscribeLog(max, listener, onError) {
      return adminRead(
        (state) => newestFirst(state.adminLog).slice(0, max),
        listener,
        onError,
      );
    },
    subscribeHistory(cafeId, listener, onError) {
      return adminRead(
        (state) => ({
          requests: state.requests
            .filter((r) => r.cafeId === cafeId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, HISTORY_LIMIT),
          deployments: state.deployments
            .filter((d) => d.cafeId === cafeId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, HISTORY_LIMIT),
          log: newestFirst(state.adminLog.filter((e) => e.cafeId === cafeId)),
          emails: newestFirst(state.emails.filter((e) => e.cafeId === cafeId))
            .slice(0, HISTORY_LIMIT)
            .map(({ id, kind, at }) => ({ id, kind, at })),
        }),
        listener,
        onError,
      );
    },
    subscribeMine(max, listener, onError) {
      return adminRead(
        (state) => {
          const uid = state.session;
          return state.requests
            .filter((r) => r.by === uid)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, max);
        },
        listener,
        onError,
      );
    },
    async ask({ cafeId, kind, params }) {
      return mutate((state) => {
        const admin = currentUser(state);
        if (!admin || !isAdmin(state)) throw denied();
        const now = Date.now();
        let record;
        try {
          record = newRequestRecord(
            { cafeId, kind, params, by: admin.uid },
            now,
          );
        } catch (error) {
          throw new CodedError(
            "invalid-argument",
            error instanceof Error ? error.message : String(error),
          );
        }
        if (cafeId !== null && !state.cafes.some((c) => c.id === cafeId)) {
          throw denied(); // the rules' lookup of the cafe fails
        }
        const request: BackendRequest = {
          id: makeId("req"),
          ...record,
          progress: null,
          result: null,
          error: null,
          errorCode: null,
          deploymentId: null,
          notBefore: null,
          finishedAt: null,
        };
        let outcome: Outcome;
        try {
          outcome = HANDLERS[kind]({ state, request, admin, policy, now });
        } catch (error) {
          if (!(error instanceof CodedError)) throw error;
          outcome = {
            status: "failed",
            errorCode: error.code,
            error: error.message,
          };
        }
        Object.assign(request, outcome);
        if (request.status === "done" || request.status === "failed") {
          request.finishedAt = now;
        }
        state.requests.unshift(request);
        return request.id;
      });
    },
  };
}
