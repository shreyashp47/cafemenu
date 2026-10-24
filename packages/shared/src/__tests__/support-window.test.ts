import { describe, expect, it } from "vitest";

import {
  NOTICE_DAYS,
  compareLines,
  lineSupport,
  stableLineOf,
  supportNotice,
  supportWindow,
  toMillis,
} from "../support-window.mjs";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

/** A published release: `version` first published on `date` (UTC midnight). */
const rel = (version: string, date: string, extra = {}) => ({
  version,
  channel: "stable",
  publishedAt: at(date),
  withdrawn: false,
  ...extra,
});

/** 1.3.0 on 1 Jun, 1.4.0 on 1 Aug, 1.5.0 on 10 Oct 2026 (a Saturday-ish; times are UTC). */
const history = [
  rel("1.3.0", "2026-06-01"),
  rel("1.3.1", "2026-06-20"),
  rel("1.4.0", "2026-08-01"),
  rel("1.4.1", "2026-08-15"),
  rel("1.5.0", "2026-10-10"),
];

describe("which lines are supported", () => {
  it("is the latest two minor lines", () => {
    const window = supportWindow(history);
    expect(window.supported).toEqual(["1.5", "1.4"]);
    expect(window.lines.map((l) => l.line)).toEqual(["1.5", "1.4", "1.3"]);
  });

  it("compares lines as numbers, not text", () => {
    expect(compareLines("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareLines("2.0", "1.99")).toBeGreaterThan(0);
    const window = supportWindow([
      rel("1.9.0", "2026-01-01"),
      rel("1.10.0", "2026-02-01"),
      rel("1.11.0", "2026-03-01"),
    ]);
    expect(window.supported).toEqual(["1.11", "1.10"]);
  });

  it("counts a new major line as a line", () => {
    const window = supportWindow([
      rel("1.8.0", "2026-01-01"),
      rel("1.9.0", "2026-02-01"),
      rel("2.0.0", "2026-03-01"),
    ]);
    expect(window.supported).toEqual(["2.0", "1.9"]);
  });

  it("ignores betas, release candidates, withdrawn releases and junk", () => {
    const window = supportWindow([
      ...history,
      rel("1.6.0-beta.1", "2026-10-20", { channel: "beta" }),
      rel("1.6.0-rc.1", "2026-10-21", { channel: "beta" }),
      // Published to beta and not promoted yet.
      rel("1.6.0", "2026-10-22", { channel: "beta" }),
      rel("1.7.0", "2026-10-23", { withdrawn: true }),
      { version: "v1.8.0", publishedAt: at("2026-10-24") },
      { version: "latest" },
      null,
    ] as never);
    expect(window.supported).toEqual(["1.5", "1.4"]);
  });

  it("takes a release with no channel recorded as stable", () => {
    const window = supportWindow([{ version: "1.0.0" }, { version: "1.1.0" }]);
    expect(window.supported).toEqual(["1.1", "1.0"]);
  });

  it("supports what there is when fewer than two lines exist", () => {
    expect(supportWindow([]).supported).toEqual([]);
    expect(supportWindow(undefined).supported).toEqual([]);
    expect(supportWindow([rel("1.0.0", "2026-01-01")]).supported).toEqual([
      "1.0",
    ]);
  });

  it("is a configurable number of lines", () => {
    expect(supportWindow(history, { supportedLines: 3 }).supported).toEqual([
      "1.5",
      "1.4",
      "1.3",
    ]);
  });

  it("moves when a line's only releases are withdrawn", () => {
    const window = supportWindow(
      history.map((r) =>
        r.version.startsWith("1.5") ? { ...r, withdrawn: true } : r,
      ),
    );
    expect(window.supported).toEqual(["1.4", "1.3"]);
  });
});

describe("the date to upgrade by", () => {
  const window = supportWindow(history);
  const now = at("2026-10-24T09:00:00Z");

  it("is 30 days after the line stopped being supported", () => {
    // 1.5.0 came out on 10 Oct: 1.3 stopped being supported then.
    const standing = lineSupport(window, "1.3", now);
    expect(standing.supported).toBe(false);
    expect(standing.droppedAt).toBe(at("2026-10-10"));
    expect(NOTICE_DAYS).toBe(30);
    expect(new Date(standing.upgradeBy!).toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
    expect(standing.due).toBe(false);
    expect(standing.daysLeft).toBe(16);
  });

  it("rounds up to the next midnight UTC, so the notice is never short", () => {
    const late = supportWindow([
      rel("1.3.0", "2026-06-01"),
      rel("1.4.0", "2026-08-01"),
      {
        version: "1.5.0",
        channel: "stable",
        publishedAt: at("2026-10-10T15:30:00Z"),
      },
    ]);
    const standing = lineSupport(late, "1.3", now);
    // 10 Oct 15:30 + 30 days is 9 Nov 15:30: the 10th, at 00:00, is next.
    expect(new Date(standing.upgradeBy!).toISOString()).toBe(
      "2026-11-10T00:00:00.000Z",
    );
    expect(standing.upgradeBy! - standing.droppedAt!).toBeGreaterThanOrEqual(
      30 * DAY,
    );
  });

  it("is exactly 30 days when the release came out at midnight", () => {
    const standing = lineSupport(window, "1.3", now);
    expect(standing.upgradeBy! - standing.droppedAt!).toBe(30 * DAY);
  });

  it("is due from the first moment of the day, not before", () => {
    const day = at("2026-11-09");
    expect(lineSupport(window, "1.3", day - 1).due).toBe(false);
    expect(lineSupport(window, "1.3", day - 1).daysLeft).toBe(1);
    expect(lineSupport(window, "1.3", day).due).toBe(true);
    expect(lineSupport(window, "1.3", day).daysLeft).toBe(0);
    expect(lineSupport(window, "1.3", day + 40 * DAY).due).toBe(true);
    expect(lineSupport(window, "1.3", day + 40 * DAY).daysLeft).toBe(0);
  });

  it("counts whole days left, rounding up", () => {
    const day = at("2026-11-09");
    expect(lineSupport(window, "1.3", day - 3 * DAY).daysLeft).toBe(3);
    expect(lineSupport(window, "1.3", day - 3 * DAY + 1).daysLeft).toBe(3);
    expect(lineSupport(window, "1.3", day - 3 * DAY - 1).daysLeft).toBe(4);
  });

  it("starts the clock when the second newer line appeared, not the first", () => {
    // 1.4 was displaced by 1.5 and 1.6: 1.6.0 starts its clock, not 1.5.0.
    const later = supportWindow([...history, rel("1.6.0", "2026-12-01")]);
    expect(later.supported).toEqual(["1.6", "1.5"]);
    const standing = lineSupport(later, "1.4", at("2026-12-02"));
    expect(standing.droppedAt).toBe(at("2026-12-01"));
    expect(new Date(standing.upgradeBy!).toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });

  it("gives an older line the date its own displacement set, and it stays put", () => {
    const later = supportWindow([...history, rel("1.6.0", "2026-12-01")]);
    // 1.3 was already displaced by 1.5.0: a newer release doesn't move its date.
    expect(lineSupport(later, "1.3", at("2026-12-02")).upgradeBy).toBe(
      at("2026-11-09"),
    );
  });

  it("is judged by publication order when lines came out out of order", () => {
    // 1.5.0 first, then a backport line 1.3.0 and 1.4.0 later: 1.2 is out only
    // once two newer lines exist, which is when the second of them appeared.
    const odd = supportWindow([
      rel("1.2.0", "2026-01-01"),
      rel("1.5.0", "2026-02-01"),
      rel("1.4.0", "2026-03-01"),
      rel("1.3.0", "2026-04-01"),
    ]);
    const standing = lineSupport(odd, "1.2", at("2026-05-01"));
    expect(standing.droppedAt).toBe(at("2026-03-01"));
  });

  it("uses the line's first stable release, not a later patch", () => {
    const standing = lineSupport(
      supportWindow([
        rel("1.5.1", "2026-10-30"),
        rel("1.5.0", "2026-10-10"),
        ...history.filter((r) => !r.version.startsWith("1.5")),
      ]),
      "1.3",
      now,
    );
    expect(standing.droppedAt).toBe(at("2026-10-10"));
  });

  it("is judged for a line nobody published a release of", () => {
    // 1.3 and 1.4 were newer from 1 August on: that is when 1.2 fell out.
    const standing = lineSupport(window, "1.2", now);
    expect(standing.supported).toBe(false);
    expect(standing.droppedAt).toBe(at("2026-08-01"));
  });

  it("has no date when a release carries none, and so forces nothing", () => {
    const undated = supportWindow([
      rel("1.3.0", "2026-06-01"),
      { version: "1.4.0" },
      rel("1.5.0", "2026-10-10"),
    ]);
    const standing = lineSupport(undated, "1.3", now);
    expect(standing).toMatchObject({
      supported: false,
      droppedAt: null,
      upgradeBy: null,
      due: false,
      daysLeft: null,
    });
  });

  it("reads dates in the shapes Firestore and JSON give", () => {
    const shapes = supportWindow([
      { version: "1.3.0", publishedAt: new Date("2026-06-01") },
      { version: "1.4.0", publishedAt: "2026-08-01T00:00:00Z" },
      { version: "1.5.0", publishedAt: { toMillis: () => at("2026-10-10") } },
    ]);
    expect(lineSupport(shapes, "1.3", now).upgradeBy).toBe(at("2026-11-09"));
    expect(toMillis("not a date")).toBeNull();
    expect(toMillis(NaN)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
  });
});

describe("a supported line", () => {
  const window = supportWindow(history);
  it("has no date and is never due", () => {
    for (const line of ["1.5", "1.4"]) {
      expect(lineSupport(window, line, at("2030-01-01"))).toEqual({
        line,
        supported: true,
        droppedAt: null,
        upgradeBy: null,
        due: false,
        daysLeft: null,
      });
    }
  });

  it("includes a line newer than any published", () => {
    expect(lineSupport(window, "1.6", at("2026-10-24")).supported).toBe(true);
  });

  it("includes the only line there is", () => {
    const one = supportWindow([rel("1.0.0", "2026-01-01")]);
    expect(lineSupport(one, "1.0", at("2027-01-01")).supported).toBe(true);
  });
});

describe("the notice for a cafe", () => {
  const now = at("2026-10-24T09:00:00Z");

  it("is for a cafe pinned to an unsupported line", () => {
    const notice = supportNotice({ pinned: "1.3" }, history, now);
    expect(notice).toMatchObject({ line: "1.3", daysLeft: 16, due: false });
  });

  it("is overdue after the date, until the cafe is moved", () => {
    const notice = supportNotice({ pinned: "1.3" }, history, at("2026-11-20"));
    expect(notice).toMatchObject({ due: true, daysLeft: 0 });
  });

  it("is none for a cafe on a supported line, or following a channel", () => {
    expect(supportNotice({ pinned: "1.4" }, history, now)).toBeNull();
    expect(supportNotice({ pinned: "1.5" }, history, now)).toBeNull();
    expect(supportNotice({ pinned: null }, history, now)).toBeNull();
    expect(supportNotice({}, history, now)).toBeNull();
    expect(supportNotice(undefined, history, now)).toBeNull();
  });

  it("is none when no releases are known, rather than a guess", () => {
    expect(supportNotice({ pinned: "1.3" }, [], now)).toBeNull();
    expect(supportNotice({ pinned: "1.3" }, undefined, now)).toBeNull();
  });

  it("is none for a pin that is not a line", () => {
    expect(supportNotice({ pinned: "1.3.2" }, history, now)).toBeNull();
    expect(supportNotice({ pinned: "latest" }, history, now)).toBeNull();
  });
});

describe("version helpers", () => {
  it("names the line of a stable release only", () => {
    expect(stableLineOf("1.4.2")).toBe("1.4");
    expect(stableLineOf("1.4.2-beta.1")).toBeNull();
    expect(stableLineOf("v1.4.2")).toBeNull();
    expect(stableLineOf("1.04.2")).toBeNull();
    expect(stableLineOf(142)).toBeNull();
  });
});
