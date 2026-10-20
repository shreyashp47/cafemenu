import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_OPEN_HOURS,
  TABLE_OPEN_HOURS,
  TABLE_OPEN_MS,
  chooseOrderStatus,
  extendedOpenUntil,
  formatTimeLeft,
  isTableOpen,
  keepsTableOpen,
  looksOpen,
  openTables,
  parseOrderingSettings,
  parseTableSessionsDoc,
  PHONE_CLOCK_SLACK_MS,
} from "@/lib/table-open";

const NOW = Date.parse("2026-09-28T10:00:00Z");
const MIN = 60_000;

describe("choosing a new order's status", () => {
  it("waits for the counter on a closed table", () => {
    expect(
      chooseOrderStatus({ confirmNewGuests: true, tableOpen: false }),
    ).toBe("pending");
  });

  it("goes straight to the kitchen on an open table", () => {
    expect(chooseOrderStatus({ confirmNewGuests: true, tableOpen: true })).toBe(
      "preparing",
    );
  });

  it("never waits with confirmation switched off", () => {
    expect(
      chooseOrderStatus({ confirmNewGuests: false, tableOpen: false }),
    ).toBe("preparing");
  });
});

describe("the owner's switch", () => {
  it("is OFF when nothing has been saved (the owner's chosen default)", () => {
    expect(parseOrderingSettings(undefined)).toEqual({
      confirmNewGuests: false,
    });
    expect(parseOrderingSettings({})).toEqual({ confirmNewGuests: false });
  });

  it("reads a saved value", () => {
    expect(parseOrderingSettings({ confirmNewGuests: false })).toEqual({
      confirmNewGuests: false,
    });
    expect(parseOrderingSettings({ confirmNewGuests: true })).toEqual({
      confirmNewGuests: true,
    });
  });

  it("treats anything unreadable as OFF, as the rules do", () => {
    // firestore.rules only confirms on a stored `true`, so anything else
    // would make the phone send `pending` for no reason.
    expect(parseOrderingSettings({ confirmNewGuests: "yes" })).toEqual({
      confirmNewGuests: false,
    });
  });
});

describe("the phone's guess (looksOpen)", () => {
  it("says open for an open table, and for a few minutes after it closed", () => {
    expect(looksOpen(NOW + MIN, NOW)).toBe(true);
    expect(looksOpen(NOW - MIN, NOW)).toBe(true);
    expect(looksOpen(NOW - PHONE_CLOCK_SLACK_MS + 1, NOW)).toBe(true);
    expect(PHONE_CLOCK_SLACK_MS).toBe(5 * MIN);
  });

  it("says closed once the slack has passed, or with no session", () => {
    expect(looksOpen(NOW - PHONE_CLOCK_SLACK_MS, NOW)).toBe(false);
    expect(looksOpen(undefined, NOW)).toBe(false);
  });
});

describe("open tables", () => {
  const sessions = { 2: NOW + 90 * MIN, 5: NOW - MIN, 9: NOW + 5 * MIN };

  it("is open only while openUntil is in the future", () => {
    expect(isTableOpen(sessions, 2, NOW)).toBe(true);
    expect(isTableOpen(sessions, 5, NOW)).toBe(false);
    expect(isTableOpen(sessions, 7, NOW)).toBe(false);
    expect(isTableOpen({ 1: NOW }, 1, NOW)).toBe(false);
  });

  it("lists open tables in order with time left, and drops closed ones", () => {
    expect(openTables(sessions, NOW)).toEqual([
      { table: 2, openUntil: NOW + 90 * MIN, msLeft: 90 * MIN },
      { table: 9, openUntil: NOW + 5 * MIN, msLeft: 5 * MIN },
    ]);
  });

  it("says how long is left in words a barista reads at a glance", () => {
    expect(formatTimeLeft(3 * 60 * MIN)).toBe("3h left");
    expect(formatTimeLeft(161 * MIN + 20_000)).toBe("2h 41m left");
    expect(formatTimeLeft(12 * MIN)).toBe("12m left");
    expect(formatTimeLeft(30_000)).toBe("under a minute left");
  });

  it("opens for three hours and only ever pushes the time forward", () => {
    expect(TABLE_OPEN_HOURS).toBe(3);
    expect(extendedOpenUntil(undefined, NOW)).toBe(NOW + TABLE_OPEN_MS);
    expect(extendedOpenUntil(NOW + MIN, NOW)).toBe(NOW + TABLE_OPEN_MS);
    expect(extendedOpenUntil(NOW + 4 * 60 * MIN, NOW)).toBe(NOW + 4 * 60 * MIN);
  });

  it("is kept open by kitchen steps, not by completing or rejecting", () => {
    expect(keepsTableOpen("preparing")).toBe(true);
    expect(keepsTableOpen("ready")).toBe(true);
    expect(keepsTableOpen("served")).toBe(true);
    expect(keepsTableOpen("completed")).toBe(false);
    expect(keepsTableOpen("rejected")).toBe(false);
  });

  it("reads a stored session from Firestore or the demo store", () => {
    expect(parseTableSessionsDoc("4", { openUntil: NOW })).toEqual([4, NOW]);
    expect(
      parseTableSessionsDoc("4", { openUntil: { toMillis: () => NOW } }),
    ).toEqual([4, NOW]);
    expect(parseTableSessionsDoc("abc", { openUntil: NOW })).toBeNull();
    expect(parseTableSessionsDoc("51", { openUntil: NOW })).toBeNull();
    expect(parseTableSessionsDoc("4", { openUntil: "soon" })).toBeNull();
    expect(parseTableSessionsDoc("4", undefined)).toBeNull();
  });

  it("uses the same limits as firestore.rules", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    expect(rules).toContain(
      `request.resource.data.openUntil <= request.time + duration.value(${MAX_OPEN_HOURS}, 'h')`,
    );
    expect(TABLE_OPEN_HOURS).toBeLessThan(MAX_OPEN_HOURS);
    // Missing document or field = OFF, as parseOrderingSettings says.
    expect(rules).toContain("return !exists(ordering)");
    expect(rules).toContain(
      'get(ordering).data.get("confirmNewGuests", false) != true',
    );
  });
});
