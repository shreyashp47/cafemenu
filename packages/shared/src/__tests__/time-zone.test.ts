import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  dayKeyIn,
  dayKeysAt,
  dayStartIn,
  isTimeZone,
  isUtcOffsets,
  utcOffsetAt,
  utcOffsetsOf,
  wallTimeIn,
} from "../time-zone.ts";

const at = (iso: string) => Date.parse(iso);
const HOUR = 3_600_000;

/**
 * Every 20 minutes of `year`, starting 7 minutes past midnight UTC. The windows
 * these tests look for are 30 minutes or longer, so each is sampled at least
 * once, at a time no zone's midnight falls on.
 */
function samples(year: number): number[] {
  const out: number[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  for (let ms = Date.UTC(year, 0, 1, 0, 7); ms < end; ms += 20 * 60_000) {
    out.push(ms);
  }
  return out;
}

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
    ["Pacific/Auckland", 720, 780],
    // Daylight saving suspended for five weeks around Ramadan, from the 15th
    // to the 22nd: no first of the month in 2026 sees the +0.
    ["Africa/Casablanca", 0, 60],
  ])("%s is %i standard, %i daylight", (zone, standard, daylight) => {
    expect(utcOffsetsOf(zone, 2026)).toEqual({ standard, daylight });
  });
});

// The five zones of issue #13. The instants are 2026's real transitions.
describe("dayKeyIn", () => {
  it("cuts Asia/Kolkata's day at 18:30 UTC, as TOE's fixed +5:30 did", () => {
    expect(dayKeyIn("Asia/Kolkata", at("2026-09-27T18:29:59.999Z"))).toBe(
      "2026-09-27",
    );
    expect(dayKeyIn("Asia/Kolkata", at("2026-09-27T18:30:00Z"))).toBe(
      "2026-09-28",
    );
    expect(dayKeyIn("Asia/Kolkata", at("2026-12-31T18:30:00Z"))).toBe(
      "2027-01-01",
    );
    expect(dayKeyIn("Asia/Kolkata", at("2028-02-28T19:00:00Z"))).toBe(
      "2028-02-29",
    );
  });

  it("agrees with TOE's sum for Asia/Kolkata all year", () => {
    const toe = (ms: number) =>
      new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
    const differ = samples(2026).filter(
      (ms) => dayKeyIn("Asia/Kolkata", ms) !== toe(ms),
    );
    expect(differ).toEqual([]);
  });

  it("cuts Asia/Kathmandu's day at 18:15 UTC (+5:45)", () => {
    expect(dayKeyIn("Asia/Kathmandu", at("2026-06-14T18:14:59Z"))).toBe(
      "2026-06-14",
    );
    expect(dayKeyIn("Asia/Kathmandu", at("2026-06-14T18:15:00Z"))).toBe(
      "2026-06-15",
    );
  });

  it.each([
    // [zone, the midnight that starts a change day, the one that ends it]
    // Europe/London, clocks forward 29 March (GMT to BST), back 25 October.
    ["Europe/London", "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z"],
    ["Europe/London", "2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z"],
    // America/New_York, 8 March (EST to EDT) and 1 November.
    ["America/New_York", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["America/New_York", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
    // Pacific/Auckland, back 5 April (NZDT to NZST), forward 27 September.
    ["Pacific/Auckland", "2026-04-04T11:00:00Z", "2026-04-05T12:00:00Z"],
    ["Pacific/Auckland", "2026-09-26T12:00:00Z", "2026-09-27T11:00:00Z"],
  ])(
    "%s: a daylight-saving day runs from local midnight %s to %s",
    (zone, start, end) => {
      const day = dayKeyIn(zone, at(start));
      expect(dayKeyIn(zone, at(start) - 1)).toBe(addDays(day, -1));
      expect(dayKeyIn(zone, at(end) - 1)).toBe(day);
      expect(dayKeyIn(zone, at(end))).toBe(addDays(day, 1));
      expect(dayStartIn(zone, day)).toBe(at(start));
      expect(dayStartIn(zone, addDays(day, 1))).toBe(at(end));
    },
  );

  it("ignores the zone the device itself is in", () => {
    // Vitest runs in whatever zone the machine is set to; the answer must not
    // move with it. 23:30 in London in summer is 22:30 UTC.
    expect(dayKeyIn("Europe/London", at("2026-07-01T22:30:00Z"))).toBe(
      "2026-07-01",
    );
    expect(dayKeyIn("Europe/London", at("2026-07-01T23:30:00Z"))).toBe(
      "2026-07-02",
    );
  });
});

describe("dayStartIn", () => {
  it("is local midnight on an ordinary day", () => {
    expect(dayStartIn("Asia/Kolkata", "2026-09-28")).toBe(
      at("2026-09-27T18:30:00Z"),
    );
    expect(dayStartIn("UTC", "2026-09-28")).toBe(at("2026-09-28T00:00:00Z"));
    expect(dayStartIn("Pacific/Kiritimati", "2026-01-01")).toBe(
      at("2025-12-31T10:00:00Z"),
    );
    expect(dayStartIn("Pacific/Pago_Pago", "2026-01-01")).toBe(
      at("2026-01-01T11:00:00Z"),
    );
  });

  it("makes a change day 23 or 25 hours long", () => {
    const length = (zone: string, day: string) =>
      (dayStartIn(zone, addDays(day, 1)) - dayStartIn(zone, day)) / HOUR;
    expect(length("Europe/London", "2026-03-29")).toBe(23);
    expect(length("Europe/London", "2026-10-25")).toBe(25);
    expect(length("America/New_York", "2026-03-08")).toBe(23);
    expect(length("Pacific/Auckland", "2026-04-05")).toBe(25);
    expect(length("Australia/Lord_Howe", "2026-10-04")).toBe(23.5);
    expect(length("Asia/Kolkata", "2026-03-29")).toBe(24);
  });

  it("starts a day whose midnight is skipped when the clock jumps", () => {
    // America/Santiago goes from 23:59:59 straight to 01:00 on 6 September.
    expect(dayStartIn("America/Santiago", "2026-09-06")).toBe(
      at("2026-09-06T04:00:00Z"),
    );
    expect(dayKeyIn("America/Santiago", at("2026-09-06T04:00:00Z") - 1)).toBe(
      "2026-09-05",
    );
  });
});

describe("wallTimeIn", () => {
  it("is the cafe's date and 24-hour time, to the minute", () => {
    expect(wallTimeIn("Asia/Kolkata", at("2026-09-28T18:29:59Z"))).toBe(
      "2026-09-28 23:59",
    );
    expect(wallTimeIn("Asia/Kolkata", at("2026-09-28T18:30:00Z"))).toBe(
      "2026-09-29 00:00",
    );
    expect(wallTimeIn("America/New_York", at("2026-07-04T16:05:00Z"))).toBe(
      "2026-07-04 12:05",
    );
  });

  it("shows the repeated hour twice when the clocks go back", () => {
    expect(wallTimeIn("Europe/London", at("2026-10-25T00:30:00Z"))).toBe(
      "2026-10-25 01:30",
    );
    expect(wallTimeIn("Europe/London", at("2026-10-25T01:30:00Z"))).toBe(
      "2026-10-25 01:30",
    );
  });
});

describe("addDays and addMonths", () => {
  it("count by the calendar, across month, year and leap days", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-29", 0)).toBe("2026-03-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(addMonths("2026-03-29", 0)).toBe("2026-03-01");
  });
});

describe("dayKeysAt (what firestore.rules accepts)", () => {
  it("is one key for a zone without daylight saving", () => {
    expect(
      dayKeysAt(at("2026-09-27T18:30:00Z"), { standard: 330, daylight: 330 }),
    ).toEqual(["2026-09-28"]);
  });

  it("is two keys in the hour between the two midnights", () => {
    const london = { standard: 0, daylight: 60 };
    // 00:30 BST is 23:30 UTC: the 2nd by daylight, the 1st by standard.
    expect(dayKeysAt(at("2026-07-01T23:30:00Z"), london)).toEqual([
      "2026-07-01",
      "2026-07-02",
    ]);
    expect(dayKeysAt(at("2026-07-01T21:30:00Z"), london)).toEqual([
      "2026-07-01",
    ]);
  });

  // The guarantee the board relies on: the key the app writes is always one
  // the rules accept, all year, change days included.
  it.each([
    "Asia/Kolkata",
    "Europe/London",
    "America/New_York",
    "Asia/Kathmandu",
    "Pacific/Auckland",
    "Australia/Lord_Howe",
    "Pacific/Chatham",
    "America/Santiago",
    "Africa/Casablanca",
    "Pacific/Kiritimati",
    "Pacific/Pago_Pago",
  ])("always includes dayKeyIn for %s", (zone) => {
    const offsets = utcOffsetsOf(zone, 2026);
    const most = offsets.standard === offsets.daylight ? 1 : 2;
    const refused = samples(2026).filter((ms) => {
      const keys = dayKeysAt(ms, offsets);
      return !keys.includes(dayKeyIn(zone, ms)) || keys.length > most;
    });
    expect(refused.map((ms) => new Date(ms).toISOString())).toEqual([]);
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
