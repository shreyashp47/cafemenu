/**
 * The admin's forms to request params (#78): the policy's reasons and notice
 * periods, times on the cafe's own clock, the typed address for delete, and
 * params the shared request check (and so the rules) accepts.
 */

import {
  ADMIN_POLICY,
  NOTICE_DAYS,
  SUSPENSION_REASONS,
} from "@cafemenu/shared/admin-policy";
import { requestParamsProblem } from "@cafemenu/shared/requests";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MAINTENANCE,
  adminParams,
  confirmsSite,
  deleteParams,
  fromInputTime,
  maintenanceOffParams,
  maintenanceOnParams,
  noticeUntil,
  reactivateParams,
  suspendParams,
  toInputTime,
} from "../actions";

const KOLKATA = "Asia/Kolkata";
const NOW = Date.UTC(2026, 9, 27, 4, 30); // 10:00 in Kolkata
const DAY = 24 * 3600_000;

describe("times on the cafe's clock", () => {
  it("round-trips through the form", () => {
    expect(toInputTime(NOW, KOLKATA)).toBe("2026-10-27T10:00");
    expect(fromInputTime("2026-10-27T10:00", KOLKATA)).toBe(NOW);
    expect(fromInputTime("", KOLKATA)).toBeNull();
    expect(fromInputTime("2026-02-30T10:00", KOLKATA)).toBeUndefined();
  });
});

describe("suspend", () => {
  it("takes a reason from the policy, and effect now when it needs no notice", () => {
    const result = suspendParams(
      { reason: "abuse", note: " Spam orders. ", effectiveAt: "" },
      KOLKATA,
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      params: { reason: "abuse", note: "Spam orders.", effectiveAt: null },
    });
    if (result.ok)
      expect(requestParamsProblem("suspend", result.params)).toBeNull();
  });

  it("refuses a reason the policy doesn't list, and a long note", () => {
    const form = { reason: "rude", note: "", effectiveAt: "" };
    expect(suspendParams(form, KOLKATA, NOW)).toEqual({
      ok: false,
      problem: "reason",
    });
    expect(
      suspendParams(
        { ...form, reason: "abuse", note: "x".repeat(501) },
        KOLKATA,
        NOW,
      ),
    ).toEqual({ ok: false, problem: "note-long" });
  });

  it("holds non-payment to its notice period, on the cafe's clock", () => {
    expect(NOTICE_DAYS["non-payment"]).toBe(7);
    expect(noticeUntil("non-payment", NOW)).toBe(NOW + 7 * DAY);
    expect(noticeUntil("security", NOW)).toBeNull();
    const form = { reason: "non-payment", note: "", effectiveAt: "" };
    expect(suspendParams(form, KOLKATA, NOW)).toEqual({
      ok: false,
      problem: "notice",
    });
    expect(
      suspendParams({ ...form, effectiveAt: "2026-11-02T10:00" }, KOLKATA, NOW),
    ).toEqual({ ok: false, problem: "notice" });
    const result = suspendParams(
      { ...form, effectiveAt: "2026-11-03T10:00" },
      KOLKATA,
      NOW,
    );
    expect(result.ok && result.params.effectiveAt).toEqual(
      new Date(NOW + 7 * DAY),
    );
  });

  it("follows another policy when given one", () => {
    const policy = { ...ADMIN_POLICY, noticeDays: { abuse: 1 } };
    expect(
      suspendParams(
        { reason: "abuse", note: "", effectiveAt: "" },
        KOLKATA,
        NOW,
        policy,
      ),
    ).toEqual({ ok: false, problem: "notice" });
  });
});

describe("reactivate and delete", () => {
  it("reactivates for a reactivation reason only", () => {
    expect(reactivateParams({ reason: "resolved", note: "" })).toEqual({
      ok: true,
      params: { reason: "resolved", note: "" },
    });
    expect(reactivateParams({ reason: "abuse", note: "" }).ok).toBe(false);
  });

  it("deletes only once the cafe's web address is typed", () => {
    const cafe = { site: "tea-room" };
    const form = { reason: "owner-request", note: "", confirm: "tea-roo" };
    expect(deleteParams(form, cafe)).toEqual({ ok: false, problem: "confirm" });
    for (const typed of [
      "tea-room",
      "https://tea-room.web.app",
      " TEA-ROOM.web.app/ ",
    ]) {
      expect(confirmsSite(typed, cafe)).toBe(true);
      const result = deleteParams({ ...form, confirm: typed }, cafe);
      expect(result).toEqual({
        ok: true,
        params: { reason: "owner-request", note: "", confirm: "tea-room" },
      });
      if (result.ok)
        expect(requestParamsProblem("delete-owner", result.params)).toBeNull();
    }
  });
});

describe("maintenance", () => {
  it("reads the schedule on the cafe's clock", () => {
    const result = maintenanceOnParams(
      {
        ...EMPTY_MAINTENANCE,
        reason: "migration",
        message: " Back after a short update. ",
        startsAt: "2026-10-27T22:00",
        endsAt: "2026-10-28T02:00",
        until: "2026-10-28T02:00",
      },
      KOLKATA,
      NOW,
      "batch-1",
    );
    expect(result).toEqual({
      ok: true,
      params: {
        reason: "migration",
        note: "",
        message: "Back after a short update.",
        startsAt: new Date(Date.UTC(2026, 9, 27, 16, 30)),
        endsAt: new Date(Date.UTC(2026, 9, 27, 20, 30)),
        until: new Date(Date.UTC(2026, 9, 27, 20, 30)),
        batch: "batch-1",
      },
    });
    if (result.ok)
      expect(requestParamsProblem("maintenance-on", result.params)).toBeNull();
  });

  it("says what's wrong with a schedule", () => {
    const form = { ...EMPTY_MAINTENANCE, reason: "security" };
    const problem = (patch: Partial<typeof form>) => {
      const r = maintenanceOnParams({ ...form, ...patch }, KOLKATA, NOW);
      return r.ok ? null : r.problem;
    };
    expect(problem({})).toBeNull();
    expect(problem({ reason: "" })).toBe("reason");
    expect(problem({ message: "x".repeat(281) })).toBe("message-long");
    expect(problem({ endsAt: "2026-10-27T09:00" })).toBe("ended");
    expect(
      problem({ startsAt: "2026-10-28T10:00", endsAt: "2026-10-28T09:00" }),
    ).toBe("ends-first");
    expect(problem({ until: "tomorrow" })).toBe("bad-time");
    // Maintenance for non-payment needs its notice too.
    expect(problem({ reason: "non-payment" })).toBe("notice");
  });

  it("turns off with a note, in a batch or not", () => {
    const result = maintenanceOffParams(" Done. ", null);
    expect(result).toEqual({
      ok: true,
      params: { note: "Done.", batch: null },
    });
    if (result.ok)
      expect(requestParamsProblem("maintenance-off", result.params)).toBeNull();
  });
});

describe("admins", () => {
  it("takes an email address", () => {
    expect(adminParams(" erin@platform.test ", "")).toEqual({
      ok: true,
      params: { email: "erin@platform.test", note: "" },
    });
    expect(adminParams("erin", "").ok).toBe(false);
  });

  it("offers every reason the policy lists, from the policy", () => {
    expect(ADMIN_POLICY.suspensionReasons).toEqual(SUSPENSION_REASONS);
  });
});
