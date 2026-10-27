import { describe, expect, it } from "vitest";

import {
  ADMIN_POLICY,
  MAINTENANCE_REASONS,
  NOTICE_DAYS,
  REASON_LABELS,
  REACTIVATION_REASONS,
  SUSPENSION_REASONS,
  earliestEffect,
} from "../admin-policy.mjs";
import {
  activeMaintenance,
  maintenanceActive,
  maintenanceProblem,
  maintenanceRecord,
  nextMaintenanceChange,
  readMaintenance,
} from "../maintenance.mjs";
import { instantIn, wallTimeIn } from "../time-zone.ts";

const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-11-01T10:00:00Z");
const HOUR = 3_600_000;

describe("the provisional policy (section 8)", () => {
  it("has the five reasons, and migration for maintenance only", () => {
    expect(SUSPENSION_REASONS).toEqual([
      "abuse",
      "security",
      "legal-request",
      "non-payment",
      "owner-request",
    ]);
    expect(MAINTENANCE_REASONS).toEqual([...SUSPENSION_REASONS, "migration"]);
    for (const reason of [...MAINTENANCE_REASONS, ...REACTIVATION_REASONS]) {
      expect(REASON_LABELS[reason], reason).toBeTruthy();
    }
  });

  it("gives no notice for security and abuse, and 7 days for non-payment", () => {
    expect(NOTICE_DAYS.security).toBe(0);
    expect(NOTICE_DAYS.abuse).toBe(0);
    expect(NOTICE_DAYS["non-payment"]).toBe(7);
    expect(earliestEffect("abuse", NOW)).toBe(NOW);
    expect(earliestEffect("non-payment", NOW)).toBe(NOW + 7 * 24 * HOUR);
  });

  it("keeps suspension and maintenance apart, the staff board working, the log after a delete, and one admin", () => {
    expect(ADMIN_POLICY.suspendTurnsOnMaintenance).toBe(false);
    expect(ADMIN_POLICY.staffBoardInMaintenance).toBe("full");
    expect(ADMIN_POLICY.deleteKeeps).toEqual(["adminLog"]);
    expect(ADMIN_POLICY.appointOtherAdmins).toBe(false);
  });
});

describe("maintenance", () => {
  const on = (o = {}) => ({
    on: true,
    by: "admin",
    message: "Back soon.",
    until: null,
    startsAt: null,
    endsAt: null,
    ...o,
  });

  it("reads a stored record, times from Timestamps, Dates or numbers", () => {
    expect(
      readMaintenance(
        on({
          until: { toMillis: () => NOW + HOUR },
          startsAt: new Date(NOW),
          endsAt: NOW + 2 * HOUR,
        }),
      ),
    ).toEqual({
      on: true,
      by: "admin",
      message: "Back soon.",
      until: NOW + HOUR,
      startsAt: NOW,
      endsAt: NOW + 2 * HOUR,
    });
    expect(readMaintenance(on({ by: "someone" }))?.by).toBe("owner");
    expect(readMaintenance({ on: false })).toBe(null);
    expect(readMaintenance(null)).toBe(null);
    expect(readMaintenance("on")).toBe(null);
  });

  it("is in effect from its start to its end, both optional", () => {
    const m = (o = {}) => readMaintenance(on(o));
    expect(maintenanceActive(m(), NOW)).toBe(true);
    expect(maintenanceActive(m({ startsAt: NOW + HOUR }), NOW)).toBe(false);
    expect(maintenanceActive(m({ startsAt: NOW }), NOW)).toBe(true);
    expect(maintenanceActive(m({ endsAt: NOW }), NOW)).toBe(false);
    expect(maintenanceActive(m({ endsAt: NOW + 1 }), NOW)).toBe(true);
    expect(maintenanceActive(null, NOW)).toBe(false);
  });

  it("is the admin's when both are on, else whichever is", () => {
    expect(
      activeMaintenance(
        { site: on(), owner: on({ by: "owner", message: "Holiday." }) },
        NOW,
      )?.by,
    ).toBe("admin");
    expect(
      activeMaintenance(
        { site: null, owner: on({ by: "owner", message: "Holiday." }) },
        NOW,
      )?.message,
    ).toBe("Holiday.");
    expect(activeMaintenance({ site: { name: "x" }, owner: null }, NOW)).toBe(
      null,
    );
  });

  it("says when to look again, for a schedule", () => {
    expect(
      nextMaintenanceChange(
        {
          site: on({ startsAt: NOW + 2 * HOUR, endsAt: NOW + 5 * HOUR }),
          owner: on({ by: "owner", endsAt: NOW + HOUR }),
        },
        NOW,
      ),
    ).toBe(NOW + HOUR);
    expect(nextMaintenanceChange({ site: on(), owner: null }, NOW)).toBe(null);
  });

  it("refuses a message too long, and an end before the start or already past", () => {
    expect(maintenanceProblem({ message: "x".repeat(281) }, NOW)).toBe(
      "message-long",
    );
    expect(maintenanceProblem({ endsAt: NOW - 1 }, NOW)).toBe("ended");
    expect(
      maintenanceProblem({ startsAt: NOW + 2 * HOUR, endsAt: NOW + HOUR }, NOW),
    ).toBe("ends-first");
    expect(maintenanceProblem({ endsAt: NOW + HOUR }, NOW)).toBe(null);
  });

  it("makes the record to store, with times as the store wants them", () => {
    expect(
      maintenanceRecord(
        { by: "owner", message: "  Holiday.  ", endsAt: NOW + HOUR },
        NOW,
        (ms) => ({ seconds: ms / 1000 }),
      ),
    ).toEqual({
      on: true,
      by: "owner",
      message: "Holiday.",
      until: null,
      startsAt: null,
      endsAt: { seconds: (NOW + HOUR) / 1000 },
    });
    expect(() =>
      maintenanceRecord({ by: "owner", endsAt: NOW - HOUR }, NOW),
    ).toThrow(/ended/);
    // @ts-expect-error: not a maker of maintenance
    expect(() => maintenanceRecord({ by: "staff" }, NOW)).toThrow();
  });
});

describe("a date and time in the cafe's own zone", () => {
  it("is the instant a clock there shows it, wherever the device is", () => {
    expect(instantIn("Asia/Kolkata", "2026-11-01 22:00")).toBe(
      at("2026-11-01T16:30:00Z"),
    );
    expect(instantIn("America/New_York", "2026-11-01 00:30")).toBe(
      at("2026-11-01T04:30:00Z"),
    );
    expect(instantIn("UTC", "2026-02-28 23:59")).toBe(
      at("2026-02-28T23:59:00Z"),
    );
  });

  it("goes back to the same wall time", () => {
    for (const zone of ["Europe/Berlin", "Australia/Lord_Howe", "Asia/Tokyo"]) {
      const ms = instantIn(zone, "2026-07-15 08:45");
      expect(wallTimeIn(zone, ms!)).toBe("2026-07-15 08:45");
    }
  });

  it("takes the jump for a time the clocks skip, and the first of a time they repeat", () => {
    // Berlin skips 02:00-03:00 on 29 March 2026, and repeats 02:00-03:00 on 25 October.
    expect(instantIn("Europe/Berlin", "2026-03-29 02:30")).toBe(
      at("2026-03-29T01:00:00Z"),
    );
    expect(instantIn("Europe/Berlin", "2026-10-25 02:30")).toBe(
      at("2026-10-25T00:30:00Z"),
    );
  });

  it("is null for what isn't a date and time", () => {
    expect(instantIn("UTC", "2026-02-31 10:00")).toBe(null);
    expect(instantIn("UTC", "tomorrow")).toBe(null);
    expect(instantIn("UTC", "2026-11-01 25:00")).toBe(null);
  });
});
