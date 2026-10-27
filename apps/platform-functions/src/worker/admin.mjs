/**
 * What only the admin may ask of the backend (#78,
 * docs/super-admin-requirements.md): the handlers for the admin's request
 * kinds, called by requests.mjs as the owner's are. Each one:
 *
 *   - checks again that the asker is a verified admin (the rules already
 *     did), and that the reason is one the policy allows, with its notice;
 *   - does the work, safe to repeat: a request picked up again after a run
 *     died finds what is done already done;
 *   - writes one entry to the admin log, under the request's id, so a retry
 *     logs nothing twice and no entry is ever changed;
 *   - emails the owner, once per request.
 *
 * The policy is @cafemenu/shared/admin-policy (section 8's provisional
 * decisions), `env.policy` in tests.
 *
 *   suspend          the owner's login is disabled, each of their cafes is
 *                    `suspended` (what it was is kept, for reactivate), and
 *                    their requests are refused with the reason from then
 *                    on. A reason with a notice period waits for its date,
 *                    with a notice email now. Their sites keep running.
 *   reactivate       all of that undone; a suspension still waiting for its
 *                    date is cancelled.
 *   delete-owner     their login, cafes, deployments, requests and directory
 *                    entry are deleted; the admin log stays. Nothing in the
 *                    owner's own Firebase project is touched.
 *   maintenance-on   config/site.maintenance in the cafe's own project, with
 *                    the deployer, and cafes/{id}.maintenance on the platform
 *   maintenance-off  both cleared
 *   appoint-admin    the account's `admin` claim set (while the policy allows)
 *   remove-admin     cleared, unless it is the last admin
 */
import { maintenance as setSiteMaintenance } from "@cafemenu/deployer";
import {
  ADMIN_POLICY,
  REASON_LABELS,
  earliestEffect,
} from "@cafemenu/shared/admin-policy";
import { maintenanceRecord } from "@cafemenu/shared/maintenance";
import { requestParamsProblem } from "@cafemenu/shared/requests";
import { toMillis } from "@cafemenu/shared/support-window";

import { Deferred, RequestError } from "../errors.mjs";
import { errorText, explain } from "../explain.mjs";
import { emailOwner } from "../mail/notify.mjs";
import { isTransient, withRetry } from "../retry.mjs";

/** A time picked in a form is taken as meant if it is at most this early. */
const SLACK_MS = 10 * 60_000;

const policyOf = (env) => env.policy ?? ADMIN_POLICY;

function requireAdmin(job) {
  const token = job.auth?.token ?? {};
  if (token.admin !== true || token.email_verified !== true) {
    throw new RequestError(
      "permission-denied",
      "Only CafeMenu's admin can do this.",
    );
  }
}

/** The request's params, checked again as the rules did. */
function paramsOf(job) {
  const { kind, params } = job.request;
  const problem = requestParamsProblem(kind, params);
  if (problem) {
    throw new RequestError(
      "invalid-argument",
      `This request can't be done as it is (${problem}).`,
    );
  }
  return params;
}

const reasonOf = (params) => ({ code: params.reason, note: params.note });

/** "abuse of the service": for the emails and the refusals an owner reads. */
export const reasonLabel = (reason) =>
  REASON_LABELS[reason?.code] ?? "a reason CafeMenu will explain";

/** Refuses a time earlier than the reason's notice allows. */
function checkNotice(env, job, reason, at) {
  const asked = job.request.createdAt ?? env.now().getTime();
  const earliest = earliestEffect(reason, asked, policyOf(env));
  if ((at ?? asked) < earliest - SLACK_MS) {
    const days = policyOf(env).noticeDays[reason];
    throw new RequestError(
      "invalid-argument",
      `${REASON_LABELS[reason]} needs ${days} days' notice: not before ${new Date(earliest).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    );
  }
}

async function cafeOf(env, job) {
  const cafe = await env.store.getCafe(job.request.cafeId);
  if (!cafe) throw new RequestError("not-found", "No such cafe.");
  return cafe;
}

/** The entry for the admin log: who, what, which cafe, when, why. */
async function log(env, job, { cafeId, ownerUid, reason, details = {} }) {
  await env.store.addAdminLog(job.request.id, {
    at: env.now(),
    by: job.request.by,
    byEmail: job.auth.token.email ?? null,
    action: job.request.kind,
    cafeId: cafeId ?? null,
    ownerUid: ownerUid ?? null,
    reason: reason ?? null,
    details,
    requestId: job.request.id,
  });
}

/** An email to the cafe's owner, keyed by the request so it goes once. */
async function email(env, job, cafe, kind, data) {
  const result = await emailOwner(env, cafe, {
    kind,
    key: `${kind}:${job.request.id}`,
    data: { timeZone: cafe.settings?.timeZone ?? "UTC", ...data },
  });
  return { sent: result.sent.length, failed: result.failed.length };
}

const statusFields = (reason, env, job) => ({
  statusReason: reason,
  statusChangedAt: env.now(),
  statusChangedBy: job.request.by,
});

// -- suspend and reactivate -------------------------------------------------------

async function suspend(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  const reason = reasonOf(params);
  const effectiveAt = toMillis(params.effectiveAt);
  checkNotice(env, job, reason.code, effectiveAt);
  const cafe = await cafeOf(env, job);
  const uid = cafe.ownerUid;
  const now = env.now().getTime();

  if (effectiveAt !== null && effectiveAt > now) {
    // A notice period: tell the owner now, and wait for the date.
    await email(env, job, cafe, "suspension-notice", {
      reasonLabel: reasonLabel(reason),
      note: reason.note,
      effectiveAt,
    });
    throw new Deferred(
      effectiveAt,
      `Scheduled for ${new Date(effectiveAt).toISOString()}.`,
    );
  }

  const cafes = await env.store.listCafesOf(uid);
  for (const c of cafes) {
    await env.store.updateCafe(c.id, {
      ...(c.status !== "suspended" && {
        status: "suspended",
        suspendedFrom: c.status,
      }),
      ...statusFields(reason, env, job),
    });
  }
  await env.store.setOwnerRecord(uid, {
    status: "suspended",
    ...statusFields(reason, env, job),
  });
  await env.store.setAccountDisabled(uid, true);
  if (policyOf(env).suspendTurnsOnMaintenance) {
    for (const c of cafes.filter((x) => x.projectId)) {
      await putSiteMaintenance(env, c, {
        by: "admin",
        message: "",
        until: null,
        startsAt: null,
        endsAt: null,
      });
    }
  }
  await log(env, job, {
    cafeId: cafe.id,
    ownerUid: uid,
    reason,
    details: { cafes: cafes.map((c) => c.id) },
  });
  const mail = await email(
    env,
    job,
    { ...cafe, status: "suspended" },
    "account-suspended",
    { reasonLabel: reasonLabel(reason), note: reason.note },
  );
  return {
    status: "done",
    result: {
      ownerUid: uid,
      cafes: cafes.map((c) => c.id),
      emailed: mail.sent,
    },
  };
}

async function reactivate(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  const reason = reasonOf(params);
  const cafe = await cafeOf(env, job);
  const uid = cafe.ownerUid;

  // A suspension still waiting for its date is called off.
  const cancelled = [];
  for (const r of await env.store.listOpenRequestsFor(cafe.id)) {
    if (r.kind !== "suspend" || r.id === job.request.id) continue;
    await env.store.updateRequest(r.id, {
      status: "failed",
      errorCode: "cancelled",
      error: "Called off: the account was reactivated first.",
      lease: null,
      finishedAt: env.now(),
    });
    cancelled.push(r.id);
  }

  const cafes = await env.store.listCafesOf(uid);
  for (const c of cafes) {
    if (c.status !== "suspended") continue;
    await env.store.updateCafe(c.id, {
      status: c.suspendedFrom ?? "live",
      suspendedFrom: null,
      ...statusFields(reason, env, job),
    });
  }
  await env.store.setOwnerRecord(uid, {
    status: "active",
    ...statusFields(reason, env, job),
  });
  await env.store.setAccountDisabled(uid, false);
  await log(env, job, {
    cafeId: cafe.id,
    ownerUid: uid,
    reason,
    details: { cafes: cafes.map((c) => c.id), cancelled },
  });
  const mail = await email(env, job, cafe, "account-reactivated", {
    reasonLabel: reasonLabel(reason),
    note: reason.note,
  });
  return {
    status: "done",
    result: {
      ownerUid: uid,
      cafes: cafes.map((c) => c.id),
      emailed: mail.sent,
    },
  };
}

// -- delete -------------------------------------------------------------------------

async function deleteOwner(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  const reason = reasonOf(params);
  const cafe = await cafeOf(env, job);
  if (params.confirm !== cafe.site) {
    throw new RequestError(
      "invalid-argument",
      "The web address typed doesn't match the cafe's.",
    );
  }
  const uid = cafe.ownerUid;
  const account = await env.store.getAccount(uid);
  if (account?.admin) {
    throw new RequestError(
      "failed-precondition",
      "This owner is an admin: remove them as an admin first.",
    );
  }
  const cafes = await env.store.listCafesOf(uid);
  // The email first, while there is an address to send it to; then the log,
  // so that even a delete cut off half-way is on record.
  const mail = await email(env, job, cafe, "account-deleted", {
    reasonLabel: reasonLabel(reason),
    note: reason.note,
  });
  await log(env, job, {
    cafeId: cafe.id,
    ownerUid: uid,
    reason,
    details: {
      cafes: cafes.map((c) => c.id),
      sites: cafes.map((c) => c.site),
    },
  });
  await env.store.deleteOwnerData(
    uid,
    cafes.map((c) => c.id),
  );
  await env.store.deleteAccount(uid);
  return {
    status: "done",
    result: {
      ownerUid: uid,
      cafes: cafes.map((c) => c.id),
      emailed: mail.sent,
    },
  };
}

// -- maintenance ---------------------------------------------------------------------

/** `deployer maintenance` on the cafe's own project, with retries; null turns it off. */
async function putSiteMaintenance(env, cafe, input) {
  if (!cafe.projectId) {
    throw new RequestError(
      "failed-precondition",
      "This cafe has no Firebase project connected, so it has no site yet.",
    );
  }
  let record = null;
  if (input) {
    try {
      record = maintenanceRecord(input, env.now().getTime());
    } catch (error) {
      throw new RequestError("invalid-argument", error.message);
    }
  }
  const ctx = await env.google.contextFor(cafe.projectId, {
    write: (line) => env.log("info", line, { cafe: cafe.id }),
    readFile: async () => {
      throw new Error("maintenance reads no files");
    },
  });
  try {
    await withRetry(() => setSiteMaintenance(ctx, { maintenance: record }), {
      sleep: env.sleep,
    });
  } catch (error) {
    if (isTransient(error)) throw error; // back in the queue
    const explanation = explain(error, {
      project: cafe.projectId,
      clientEmail: await env.google.clientEmail(),
      step: "maintenance",
    });
    throw new RequestError("failed-precondition", errorText(explanation));
  }
  return record;
}

async function maintenanceOn(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  const reason = reasonOf(params);
  const startsAt = toMillis(params.startsAt);
  checkNotice(env, job, reason.code, startsAt);
  const cafe = await cafeOf(env, job);
  const input = {
    by: "admin",
    message: params.message,
    until: toMillis(params.until),
    startsAt,
    endsAt: toMillis(params.endsAt),
  };
  const record = await putSiteMaintenance(env, cafe, input);
  await env.store.updateCafe(cafe.id, {
    maintenance: {
      ...record,
      reason,
      setAt: env.now(),
      setBy: job.request.by,
      batch: params.batch,
    },
  });
  await log(env, job, {
    cafeId: cafe.id,
    ownerUid: cafe.ownerUid,
    reason,
    details: {
      message: input.message,
      until: input.until,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      batch: params.batch,
    },
  });
  const mail = await email(env, job, cafe, "maintenance-on", {
    reasonLabel: reasonLabel(reason),
    note: reason.note,
    message: record.message,
    until: input.until,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
  return { status: "done", result: { cafeId: cafe.id, emailed: mail.sent } };
}

async function maintenanceOff(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  const cafe = await cafeOf(env, job);
  await putSiteMaintenance(env, cafe, null);
  await env.store.updateCafe(cafe.id, { maintenance: null });
  await log(env, job, {
    cafeId: cafe.id,
    ownerUid: cafe.ownerUid,
    reason: { code: null, note: params.note },
    details: { batch: params.batch },
  });
  const mail = await email(env, job, cafe, "maintenance-off", {
    note: params.note,
  });
  return { status: "done", result: { cafeId: cafe.id, emailed: mail.sent } };
}

// -- admins ------------------------------------------------------------------------

async function accountByEmail(env, email) {
  const account = await env.store.findAccountByEmail(email);
  if (!account) {
    throw new RequestError(
      "not-found",
      "No CafeMenu account has that email. They sign up first.",
    );
  }
  return account;
}

async function appointAdmin(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  if (!policyOf(env).appointOtherAdmins) {
    throw new RequestError(
      "failed-precondition",
      "Appointing other admins is switched off for now (docs/super-admin-requirements.md, section 8, decision 6).",
    );
  }
  const account = await accountByEmail(env, params.email);
  await env.store.setAdminClaim(account.uid, true);
  await env.store.setOwnerRecord(account.uid, { admin: true });
  await log(env, job, {
    reason: { code: null, note: params.note },
    details: { uid: account.uid, email: params.email },
  });
  return { status: "done", result: { uid: account.uid } };
}

async function removeAdmin(env, job) {
  requireAdmin(job);
  const params = paramsOf(job);
  const account = await accountByEmail(env, params.email);
  if (account.admin) {
    const admins = await env.store.listAdmins();
    if (admins.length <= 1) {
      throw new RequestError(
        "failed-precondition",
        "The last admin can't be removed: appoint another first.",
      );
    }
    await env.store.setAdminClaim(account.uid, false);
  }
  await env.store.setOwnerRecord(account.uid, { admin: false });
  await log(env, job, {
    reason: { code: null, note: params.note },
    details: { uid: account.uid, email: params.email },
  });
  return { status: "done", result: { uid: account.uid } };
}

export const ADMIN_HANDLERS = {
  suspend,
  reactivate,
  "delete-owner": deleteOwner,
  "maintenance-on": maintenanceOn,
  "maintenance-off": maintenanceOff,
  "appoint-admin": appointAdmin,
  "remove-admin": removeAdmin,
};
