/**
 * The owner's maintenance form as data (#78): times in the cafe's own zone,
 * whatever zone the phone is in, and the record config/ownerMaintenance gets.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_MAINTENANCE_FORM,
  formatWhen,
  fromInputTime,
  ownerMaintenanceFrom,
  toInputTime,
} from "@/lib/maintenance-form";

const KOLKATA = "Asia/Kolkata";
// 1 Nov 2026, 10:00 at the cafe in Kolkata (UTC+5:30).
const TEN_AM_KOLKATA = Date.UTC(2026, 10, 1, 4, 30);

describe("times on the form", () => {
  it("reads and writes the cafe's wall clock, not the phone's", () => {
    expect(toInputTime(TEN_AM_KOLKATA, KOLKATA)).toBe("2026-11-01T10:00");
    expect(fromInputTime("2026-11-01T10:00", KOLKATA)).toBe(TEN_AM_KOLKATA);
    // The same wall clock in London is a different instant.
    expect(fromInputTime("2026-11-01T10:00", "Europe/London")).toBe(
      Date.UTC(2026, 10, 1, 10, 0),
    );
  });

  it("takes empty as no time and nonsense as no answer", () => {
    expect(fromInputTime("", KOLKATA)).toBeNull();
    expect(fromInputTime("2026-02-31T10:00", KOLKATA)).toBeUndefined();
    expect(fromInputTime("soon", KOLKATA)).toBeUndefined();
  });

  it("formats a time as the cafe's clock shows it", () => {
    expect(formatWhen(TEN_AM_KOLKATA, KOLKATA)).toMatch(/10:00/);
    expect(formatWhen(TEN_AM_KOLKATA, "UTC")).toMatch(/4:30/);
  });
});

describe("the record to save", () => {
  const now = TEN_AM_KOLKATA - 3600_000;

  it("is the owner's, on, with Dates for the times set", () => {
    const result = ownerMaintenanceFrom(
      {
        message: "  Closed for Diwali.  ",
        until: "2026-11-03T09:00",
        startsAt: "2026-11-01T10:00",
        endsAt: "",
      },
      KOLKATA,
      now,
    );
    expect(result).toEqual({
      ok: true,
      record: {
        on: true,
        by: "owner",
        message: "Closed for Diwali.",
        until: new Date(Date.UTC(2026, 10, 3, 3, 30)),
        startsAt: new Date(TEN_AM_KOLKATA),
        endsAt: null,
      },
    });
  });

  it("starts now when nothing is filled in", () => {
    const result = ownerMaintenanceFrom(EMPTY_MAINTENANCE_FORM, KOLKATA, now);
    expect(result).toEqual({
      ok: true,
      record: {
        on: true,
        by: "owner",
        message: "",
        until: null,
        startsAt: null,
        endsAt: null,
      },
    });
  });

  it("says what's wrong instead", () => {
    const form = { ...EMPTY_MAINTENANCE_FORM };
    const problem = (patch: Partial<typeof form>) => {
      const result = ownerMaintenanceFrom({ ...form, ...patch }, KOLKATA, now);
      return result.ok ? null : result.problem;
    };
    expect(problem({ message: "x".repeat(281) })).toBe("message-long");
    expect(problem({ endsAt: "2026-11-01T08:00" })).toBe("ended");
    expect(
      problem({ startsAt: "2026-11-02T10:00", endsAt: "2026-11-02T09:00" }),
    ).toBe("ends-first");
    expect(problem({ until: "2026-13-01T10:00" })).toBe("bad-time");
  });
});
