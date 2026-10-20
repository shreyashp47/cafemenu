import { describe, expect, it } from "vitest";

import {
  isTimeZone,
  isUtcOffsets,
  utcOffsetAt,
  utcOffsetsOf,
} from "../time-zone.ts";

describe("isTimeZone", () => {
  it("knows real IANA zones", () => {
    for (const zone of ["Asia/Kolkata", "Europe/London", "UTC"]) {
      expect(isTimeZone(zone)).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      " Asia/Kolkata",
      "Mars/Base",
      "IST+5:30",
      330,
      null,
    ]) {
      expect(isTimeZone(bad)).toBe(false);
    }
  });
});

describe("utcOffsetAt", () => {
  it("reads a zone's offset at an instant, daylight saving included", () => {
    expect(utcOffsetAt("Asia/Kolkata", Date.UTC(2026, 0, 15, 12))).toBe(330);
    expect(utcOffsetAt("Europe/London", Date.UTC(2026, 0, 15, 12))).toBe(0);
    expect(utcOffsetAt("Europe/London", Date.UTC(2026, 6, 15, 12))).toBe(60);
    expect(utcOffsetAt("America/New_York", Date.UTC(2026, 6, 15, 12))).toBe(
      -240,
    );
  });

  it("is not thrown by an instant that is not on a whole minute", () => {
    expect(
      utcOffsetAt("Asia/Kolkata", Date.UTC(2026, 0, 15, 12) + 59_999),
    ).toBe(330);
  });
});

describe("utcOffsetsOf", () => {
  it.each([
    ["Asia/Kolkata", 330, 330],
    ["Asia/Kathmandu", 345, 345],
    ["UTC", 0, 0],
    ["Europe/London", 0, 60],
    ["America/New_York", -300, -240],
    // Southern hemisphere: daylight saving spans the new year.
    ["Australia/Sydney", 600, 660],
    // Half an hour of daylight saving.
    ["Australia/Lord_Howe", 630, 660],
    ["Pacific/Kiritimati", 840, 840],
  ])("%s is %i standard, %i daylight", (zone, standard, daylight) => {
    expect(utcOffsetsOf(zone, 2026)).toEqual({ standard, daylight });
  });
});

describe("isUtcOffsets", () => {
  it("takes whole minutes in range with daylight at or after standard", () => {
    expect(isUtcOffsets({ standard: 330, daylight: 330 })).toBe(true);
    expect(isUtcOffsets({ standard: -720, daylight: -660 })).toBe(true);
    expect(isUtcOffsets({ standard: 780, daylight: 840 })).toBe(true);
  });

  it("refuses anything a real zone could not have", () => {
    for (const bad of [
      null,
      330,
      { standard: 330 },
      { standard: "330", daylight: 330 },
      { standard: 330.5, daylight: 330.5 },
      { standard: 60, daylight: 0 },
      { standard: 0, daylight: 180 },
      { standard: -780, daylight: -780 },
      { standard: 900, daylight: 900 },
    ]) {
      expect(isUtcOffsets(bad)).toBe(false);
    }
  });
});
